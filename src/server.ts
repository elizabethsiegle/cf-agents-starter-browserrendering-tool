import {
  type AgentContext,
  type AgentNamespace,
  routeAgentRequest,
  type Schedule,
} from "agents-sdk";
import { AIChatAgent } from "agents-sdk/ai-chat-agent";
import {
  createDataStreamResponse,
  formatDataStreamPart,
  generateId,
  streamText,
  ToolExecutionError,
  type StreamTextOnFinishCallback,
  type StreamTextResult,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
import { AsyncLocalStorage } from "node:async_hooks";
import puppeteer from "@cloudflare/puppeteer";
// Environment variables type definition
export interface Env {
  OPENAI_API_KEY: string;
  Chat: AgentNamespace<Chat>;
  MYBROWSER: any;
  BROWSERDO: any;
};

const KEEP_BROWSER_ALIVE_IN_SECONDS = 60;

export class BrowserDo {
    private browser: any;
    private keptAliveInSeconds: number;
    private storage: any;

    constructor(private env: Env, state: any) {
        this.keptAliveInSeconds = 0;
        this.storage = state?.storage;
        this.env = env;
    }

    async fetch(request: Request) {
        if (!this.browser || !this.browser.isConnected()) {
            try {
                // Initialize the browser using the BROWSER binding
                this.browser = await puppeteer.launch(this.env.MYBROWSER);
            } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500 });
            }
        }
        return new Response(JSON.stringify({ status: 'ok' }));
    }

    async initBrowser() {
        if (!this.browser || !this.browser.isConnected()) {
            console.log(`Browser Manager: Starting new instance`);
            try {
                // Initialize the browser using the BROWSER binding
                console.log("pbhere");
                console.log("this.env.MYBROWSER", this.env.MYBROWSER);
                this.browser = await puppeteer.launch(this.env.MYBROWSER);
            } catch (e) {
                console.log(`Browser Manager: Could not start browser instance. Error: ${e}`);
                throw e;
            }
        }
        return this.browser;
    }

    async alarm() {
        this.keptAliveInSeconds += 10;

        // Extend browser DO life
        if (this.keptAliveInSeconds < KEEP_BROWSER_ALIVE_IN_SECONDS) {
            console.log(
                `Browser DO: has been kept alive for ${this.keptAliveInSeconds} seconds. Extending lifespan.`,
            );
            await this.storage.setAlarm(Date.now() + 10 * 1000);
        } else {
            console.log(
                `Browser DO: exceeded life of ${KEEP_BROWSER_ALIVE_IN_SECONDS}s.`,
            );
            if (this.browser) {
                console.log(`Closing browser.`);
                await this.browser.close();
            }
        }
    }

    async cleanup() {
        if (this.browser) {
            console.log('Closing browser.');
            await this.browser.close();
        }
    }
}

// we use ALS to expose the agent context to the tools
export const agentContext = new AsyncLocalStorage();
/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */
  async onChatMessage(onFinish: StreamTextOnFinishCallback<any>) {
    // Create a streaming response that handles both text and tool outputs
    return agentContext.run( { ...this, env: { ...this.env, MYBROWSER: this.env.MYBROWSER } }, async () => {
      console.log("this.env hurr", this.env);
      const dataStreamResponse = createDataStreamResponse({
        execute: async (dataStream) => {
          // Process any pending tool calls from previous messages
          // This handles human-in-the-loop confirmations for tools
          const processedMessages = await processToolCalls({
            messages: this.messages,
            dataStream,
            tools,
            executions,
          });

          const openai = createOpenAI({
            apiKey: this.env.OPENAI_API_KEY,
          });

          let result: StreamTextResult<any, any>;
          try {
            result = streamText({
              model: openai("gpt-4o-mini"),
              system: `
              You are a helpful assistant that can do various tasks. If the user asks, then you can also schedule tasks to be executed later. The input may have a date/time/cron pattern to be input as an object into a scheduler The time is now: ${new Date().toISOString()}.
              `,
              messages: processedMessages,
              tools,
              onFinish,
              onError: (error: unknown) => {
                console.error("Error in streaming:", error);
                dataStream.write(
                  formatDataStreamPart("error", JSON.stringify(error))
                );
              },
              maxSteps: 10,
            });

            // Merge the AI response stream with tool execution outputs
            result.mergeIntoDataStream(dataStream);
          } catch (error) {
            console.error("error", error);
          }
        },
      });

      return dataStreamResponse;
    });
  }
  async executeTask(description: string, task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `scheduled message: ${description}`,
      },
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!env.OPENAI_API_KEY) {
      return new Response("OPENAI_API_KEY is not set", { status: 500 });
    }

    // Create a new environment object with just the essential bindings
    const enrichedEnv = {
      ...env,
      MYBROWSER: env.MYBROWSER,
      Chat: env.Chat,
      OPENAI_API_KEY: env.OPENAI_API_KEY
    };

    const response = await routeAgentRequest(request, enrichedEnv);
    console.log("response", response);
    return response || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;