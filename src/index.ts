import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
// Import Express types correctly
import type { Request, Response } from "express";

// Enable debug logging to see what's happening
process.env.DEBUG = "mcp:*";

const app = express();
app.use(express.json());

const server = new McpServer({
  name: "Echo",
  version: "1.0.0"
});

// Register our capabilities
server.resource(
  "echo",
  new ResourceTemplate("echo://{message}", { list: undefined }),
  async (uri, { message }) => ({
    contents: [{
      uri: uri.href,
      text: `Resource echo: ${message}`
    }]
  })
);

server.tool(
  "echo",
  { message: z.string() },
  async ({ message }) => ({
    content: [{ type: "text", text: `Tool echo: ${message}` }]
  })
);

server.prompt(
  "echo",
  { message: z.string() },
  ({ message }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Please process this message: ${message}`
      }
    }]
  })
);

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

app.delete('/mcp', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. Use POST to interact with the MCP server. Follow README for details."
    },
    id: null
  }));
});

// Start the server
const PORT = process.env.MCP_SERVER_PORT || 8080;
app.listen(PORT, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});

// Base URL for the API, can be overridden by the environment variable MCP_API_URL
const API_URL =
  process.env.MCP_API_URL || "https://plus-minus-production.up.railway.app";

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
  userId: string;
  amount: number;
}

// Interface for logging interactions
interface LogInteraction {
  userId: string;
  operation: "PLUS" | "MINUS";
  amount: number;
  timestamp: string;
}

// Interface for log entries
interface LogEntry {
  userId: string;
  operation: "PLUS" | "MINUS";
  amount: number;
  timestamp: string;
}

// Interface for logs response
interface LogsResponse {
  logs: LogEntry[];
}

// Register tools for the MCP server

// @ts-ignore
server.tool(
  "plus-credits",
  "Add credits to a user account",
  {
    userId: z.string().describe("The ID of the user to add credits to"),
    amount: z.number().describe("The amount of credits to add"),
  },
  async ({ userId, amount }: CreditOperation) => {
    const url = `${API_URL}/PLUS`;
    const result = await makeAPIRequest<{ success: boolean }>(url, "POST", { userId, amount });

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to add credits.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: result.success ? "Credits added successfully." : "Failed to add credits.",
        },
      ],
    };
  },
);

// @ts-ignore
server.tool(
  "minus-credits",
  "Deduct credits from a user account",
  {
    userId: z.string().describe("The ID of the user to deduct credits from"),
    amount: z.number().describe("The amount of credits to deduct"),
  },
  async ({ userId, amount }: CreditOperation) => {
    const url = `${API_URL}/MINUS`;
    const result = await makeAPIRequest<{ success: boolean }>(url, "POST", { userId, amount });

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to deduct credits.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: result.success ? "Credits deducted successfully." : "Failed to deduct credits.",
        },
      ],
    };
  },
);

// @ts-ignore
server.tool(
  "log-interaction",
  "Log an interaction for PLUS or MINUS operations",
  {
    userId: z.string().describe("The ID of the user"),
    operation: z.enum(["PLUS", "MINUS"]).describe("The operation performed"),
    amount: z.number().describe("The amount of credits involved"),
  },
  async ({ userId, operation, amount }: LogInteraction) => {
    const url = `${API_URL}/LOGS`;
    const result = await makeAPIRequest<{ success: boolean }>(url, "POST", { userId, operation, amount, timestamp: new Date().toISOString() });

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to log interaction.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: result.success ? "Interaction logged successfully." : "Failed to log interaction.",
        },
      ],
    };
  },
);

// @ts-ignore
server.tool(
  "get-logs",
  "Retrieve log entries for PLUS and MINUS operations",
  {
    userId: z.string().describe("The ID of the user to retrieve logs for"),
  },
  async ({ userId }: { userId: string }) => {
    const url = `${API_URL}/LOGS?userId=${userId}`;
    const logsData = await makeAPIRequest<LogsResponse>(url, "GET");

    if (!logsData) {
      return {
        content: [
          {
            type: "text",
            text: "Failed to retrieve logs.",
          },
        ],
      };
    }

    const logs = logsData.logs || [];
    if (logs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No logs found for user ${userId}.`,
          },
        ],
      };
    }

    const logsText = logs.map(log => `Operation: ${log.operation}, Amount: ${log.amount}, Timestamp: ${log.timestamp}`).join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Logs for user ${userId}:\n\n${logsText}`,
        },
      ],
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

    if (!result) {
      return {
        content: [
          {
            type: "text",
            text: "Health check failed.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Health check status: ${result.status}`,
        },
      ],
    };
  },
);