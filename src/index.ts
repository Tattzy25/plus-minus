import express from "express";
import { validatePlus, validateMinus, isBalanceEligible, resolveTimestamp } from "./rules.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
// Import Express types correctly
import type { Request, Response } from "express";

// Enable debug logging to see what's happening
process.env.DEBUG = "mcp:*";

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "plus-minus",
  version: "1.0.0"
});


app.post('/mcp', async (req: Request, res: Response) => {
  try {
    // Log incoming request for debugging
    console.log('Received request:', JSON.stringify(req.body, null, 2));
    
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    
    res.on('close', () => {
      console.log('Request closed');
      transport.close();
    });
    
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req: Request, res: Response) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST to interact with the MCP server. Follow README for details."
    },
    id: null
  }));
});


app.post('/PLUS', (req: Request, res: Response) => {
  console.log('PLUS received:', req.body);
  res.json({ success: true });
});

app.post('/MINUS', (req: Request, res: Response) => {
  console.log('MINUS received:', req.body);
  res.json({ success: true });
});

app.post('/LOGS', (req: Request, res: Response) => {
  console.log('LOG received:', req.body);
  res.json({ success: true });
});

app.get('/HEALTH', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Start the server
const PORT = process.env.MCP_SERVER_PORT || 8080;
app.listen(PORT, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

// Base URL for the API, can be overridden by the environment variable MCP_API_URL
const API_URL = process.env.MCP_API_URL || "https://plus-minus.onrender.com";

// Helper function for making API requests
async function makeAPIRequest<T>(url: string, method: string, body?: any): Promise<T | null> {
  const headers = {
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Error making API request:", error);
    return null;
  }
}

// Interface for adding or deducting credits
interface CreditOperation {
  customerId: string;
  userId: string;
  creditAmount: number;
  purchaseOrderId: string;
  email: string;
  sourceId: string;
  timestamp: string;
  previousNumber: number;
  currentBalance: number;
}

type OperationType = "PLUS" | "MINUS" | "HEALTH_CHECK";

// Interface for logging interactions
interface LogInteraction {
  operation: OperationType;
  customerId?: string;
  userId?: string;
  email?: string;
  sourceId?: string;
  timestamp?: string;
  creditAmount?: number;
  previousNumber?: number;
  newBalance?: number;
  message?: string;
}


async function logOperation(data: LogInteraction): Promise<void> {
  await makeAPIRequest(`${API_URL}/LOGS`, "POST", data);
}


// Register tools for the MCP server

// @ts-ignore
server.tool(
  "plus-credits",
  "Add credits to a user account",
  {
    customerId: z.string().describe("The customer ID"),
    userId: z.string().describe("The user ID"),
    creditAmount: z.number().describe("The amount of credits to add"),
    purchaseOrderId: z.string().optional().describe("The purchase order ID"),
    email: z.string().describe("The user's email address"),
    sourceId: z.string().optional().describe("The source ID"),
    refundGrant: z.boolean().default(false).describe("Whether this is a refund grant"),
    monthlyGrant: z.boolean().default(false).describe("Whether this is a monthly grant"),
  },
  async ({ customerId, userId, creditAmount, purchaseOrderId, email, sourceId, refundGrant, monthlyGrant }) => {
    const missing = validatePlus({ customerId, userId, creditAmount, purchaseOrderId, email, sourceId });
    if (missing.length > 0) {
      return { content: [{ type: "text", text: `Missing required fields: ${missing.join(", ")}` }] };
    }

    const timestamp = resolveTimestamp();
    const result = await makeAPIRequest<{ success: boolean }>(`${API_URL}/PLUS`, "POST", { customerId, userId, creditAmount, purchaseOrderId, email, sourceId, timestamp, refundGrant, monthlyGrant });

    await logOperation({ operation: "PLUS", customerId, userId, email, sourceId, timestamp, creditAmount, message: `Added ${creditAmount} credits. Order: ${purchaseOrderId}` });

    return {
      content: [{ type: "text", text: result?.success ? "Credits added successfully." : "Failed to add credits." }],
    };
  },
);

// @ts-ignore
server.tool(
  "minus-credits",
  "Deduct credits from a user account",
  {
    customerId: z.string().describe("The customer ID"),
    userId: z.string().describe("The user ID"),
    creditAmount: z.number().describe("The amount of credits to deduct"),
    email: z.string().describe("The user's email address"),
    sourceId: z.string().describe("The source ID"),
    timestamp: z.string().describe("The timestamp of the operation"),
    previousNumber: z.number().describe("The previous credit balance"),
    currentBalance: z.number().describe("The current credit balance after the operation"),
  },
  async ({ customerId, userId, creditAmount, email, sourceId, timestamp, previousNumber, currentBalance }) => {
    const missing = validateMinus({ customerId, userId, creditAmount, email, sourceId, timestamp });
    if (missing.length > 0) {
      return { content: [{ type: "text", text: `Missing required fields: ${missing.join(", ")}` }] };
    }

    if (!isBalanceEligible(currentBalance)) {
      return { content: [{ type: "text", text: "Insufficient credits." }] };
    }

    const ts = resolveTimestamp(timestamp);
    const url = `${API_URL}/MINUS`;
    const result = await makeAPIRequest<{ success: boolean }>(url, "POST", { customerId, userId, creditAmount, email, sourceId, timestamp: ts, previousNumber, currentBalance });

    await logOperation({ operation: "MINUS", customerId, userId, email, sourceId, timestamp: ts, creditAmount, previousNumber, newBalance: currentBalance, message: `Deducted ${creditAmount} credits.` });

    return {
      content: [{ type: "text", text: result?.success ? "Credits deducted successfully." : "Failed to deduct credits." }],
    };
  },
);

// @ts-ignore
server.tool(
  "log-interaction",
  "Log an interaction for PLUS or MINUS operations",
  {
    operation: z.enum(["PLUS", "MINUS"]).describe("The operation performed"),
    customerId: z.string().describe("The customer ID"),
    userId: z.string().describe("The user ID"),
    email: z.string().describe("The user's email address"),
    sourceId: z.string().describe("The source ID"),
    timestamp: z.string().describe("The timestamp of the operation"),
    creditAmount: z.number().describe("The amount of credits involved"),
    previousNumber: z.number().describe("The previous credit balance"),
    newBalance: z.number().describe("The new credit balance after the operation"),
    message: z.string().describe("A message describing the operation"),
  },
  async ({ operation, customerId, userId, email, sourceId, timestamp, creditAmount, previousNumber, newBalance, message }: LogInteraction) => {
    const url = `${API_URL}/LOGS`;
    await makeAPIRequest<{ success: boolean }>(url, "POST", { operation, customerId, userId, email, sourceId, timestamp, creditAmount, previousNumber, newBalance, message });

    return {
      content: [{ type: "text", text: "Interaction logged." }],
    };
  },
);


// @ts-ignore
server.tool(
  "health-check",
  "Health check endpoint",
  {},
  async () => {
    const url = `${API_URL}/HEALTH`;
    const result = await makeAPIRequest<{ status: string }>(url, "GET");

    await logOperation({ operation: "HEALTH_CHECK", timestamp: resolveTimestamp(), message: `Health check: ${result?.status}` });

    return {
      content: [{ type: "text", text: `Health check status: ${result?.status}` }],
    };
  },
);