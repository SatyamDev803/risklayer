/**
 * MCP surface at /mcp (streamable HTTP, stateless). Tools call the same
 * runSku engine as REST and return the free preview: verdict and reasons.
 * Full evidence, the result hash and the on-chain receipt stay behind the
 * paid REST route, because an MCP client has no wallet to pay with.
 *
 *   claude mcp add --transport http risklayer https://<host>/mcp
 */
import { randomUUID } from "node:crypto";
import type express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { skuById } from "../catalogue.js";
import { runSku, validateQuery, type Compute } from "../products/runSku.js";

const token = z.string().describe("Token symbol (WHSK, USDT, USDC, WETH, WBTC) or a 0x address on HSK Chain");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("0x address on HSK Chain");

const TOOLS = {
  trade_gate: {
    sku: "trade-gate",
    description: "Before swapping on HSKSwap, ask whether this trade is safe. Returns ALLOW, REDUCE (with a safe size) or BLOCK, from live HSK mainnet data.",
    schema: { tokenIn: token, tokenOut: token, amountIn: z.string().describe("Amount of tokenIn, as a decimal, e.g. \"300\""), maxImpactBps: z.number().int().min(1).max(5000).optional().describe("Most price impact you accept, in basis points. Default 100") },
  },
  pay_gate: {
    sku: "pay-gate",
    description: "Before paying an address on HSK Chain, check it. Returns ALLOW, HOLD or BLOCK.",
    schema: { address },
  },
  pool_depth: {
    sku: "pool-depth",
    description: "Reserves, liquidity and a live quote for the deepest HSKSwap pool of a pair.",
    schema: { tokenA: token, tokenB: token, amount: z.string().optional().describe("Optional size of tokenA to quote") },
  },
  price_sanity: {
    sku: "price-sanity",
    description: "Compare an HSKSwap pool price with its 10 minute TWAP and the APRO oracle.",
    schema: { tokenA: token, tokenB: token },
  },
  token_check: {
    sku: "token-check",
    description: "Proxy status, admin functions in bytecode and source verification for a token contract on HSK Chain.",
    schema: { token: address },
  },
  chain_status: {
    sku: "chain-status",
    description: "Is HSK Chain live? Latest block, its age and the gas price.",
    schema: {},
  },
} as const;

function build(compute: Compute | undefined, publicUrl: string) {
  const server = new McpServer({ name: "risklayer", version: "0.1.0" });
  for (const [name, tool] of Object.entries(TOOLS)) {
    server.registerTool(name, { title: skuById(tool.sku)!.title, description: tool.description, inputSchema: tool.schema }, async (args: Record<string, unknown>) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(args ?? {})) if (v !== undefined) q.set(k, String(v));
      try {
        validateQuery(tool.sku, q);
        const env = await runSku(tool.sku, q, `mcp-${randomUUID()}`, compute);
        const paidUrl = `${publicUrl}/v1/${tool.sku}?${q.toString()}`;
        const text = [
          `Verdict: ${env.verdict}`,
          ...env.reasons.map(r => `- ${r}`),
          `Evidence from HSK Chain block ${env.proof.blockNumber}.`,
          `This is the free preview. The full answer with evidence, result hash and on-chain receipt costs ${skuById(tool.sku)!.priceUsd} USD through HSP: ${paidUrl}`,
        ].join("\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: `Could not answer: ${(e as Error).message}` }] };
      }
    });
  }
  return server;
}

export function mcpHandler(publicUrl: string, compute?: Compute): express.RequestHandler {
  return async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Use POST. This MCP server is stateless." }, id: null });
      return;
    }
    const server = build(compute, publicUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: (e as Error).message }, id: null });
    }
  };
}
