/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { agentContext, type Env, BrowserDo } from "./server";

interface AgentContext {
  env: Env;
}

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 * The actual implementation is in the executions object below
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  parameters: z.object({ city: z.string() }),
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  parameters: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  },
});

const scheduleTask = tool({
  description:
    "schedule a task to be executed at a later time. 'when' can be a date, a delay in seconds, or a cron pattern.",
  parameters: z.object({
    type: z.enum(["scheduled", "delayed", "cron"]),
    when: z.union([z.number(), z.string()]),
    payload: z.string(),
  }),
  execute: async ({ type, when, payload }) => {
    // we can now read the agent context from the ALS store
    const agent = agentContext.getStore() as AgentContext;
    if (!agent) {
      throw new Error("No agent found");
    }
    try {
      agent.schedule(
        type === "scheduled"
          ? new Date(when) // scheduled
          : type === "delayed"
          ? when // delayed
          : when, // cron
        "executeTask",
        payload
      );
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for ${when}`;
  },
});

/**
 * Tool for scraping Hacker News stories using Browser Rendering
 * Uses the Async Local Storage (ALS) context to access environment configuration to use CloudflareBrowser Rendering binding
 * The agentContext stores per-request data like environment variables and user session info
 */

const browserRender = tool({
  description: "fetch the top stories from Hacker News using browser automation",
  parameters: z.object({
    num: z.number().describe("number of stories to retrieve").default(5),
  }),
  execute: async ({ num }) => {
    const agent = agentContext.getStore() as AgentContext;
    if (!agent) {
      throw new Error("No agent found");
    }
    try {
      // Durable Object BrowserDo to keep browser instance alive and share it w/ multiple reqs
      const browserManager = new BrowserDo(agent.env, null);
      const browser = await browserManager.initBrowser();
      
      try {
        const page = await browser.newPage();
        await page.goto('https://news.ycombinator.com');
        
        const stories = await page.evaluate(() => {
          const elements = document.querySelectorAll('.athing');
          return Array.from(elements).map(element => {
            const titleElement = element.querySelector('.titleline a') as HTMLAnchorElement;
            return {
              title: titleElement?.innerText?.trim() || '',
              link: titleElement?.href || '',
            };
          });
        });

        await browser.close();
        
        const selectedStories = stories.slice(0, num);
        let htmlOutput = `<div>Here are the top ${num} Hacker News posts:</div>`;
        selectedStories.forEach((story: { title: string; link: string }, i: number) => {
          htmlOutput += `<div>${i + 1}. <a href="${story.link}" target="_blank">${story.title}</a></div>`;
        });

        return { __html: htmlOutput };
      } catch (error) {
        await browser.close();
        throw error;
      }
    } catch (error) {
      console.error("error fetching HN stories", error);
      return `Error fetching Hacker News stories: ${error}`;
    }
  },
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */

export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  browserRender,
};

/*
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async (
    args: unknown,
    context: ToolExecutionOptions
  ) => {
    const { city } = args as { city: string };
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  },
};