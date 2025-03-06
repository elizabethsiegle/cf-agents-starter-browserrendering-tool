/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { agentContext, type Env, BrowserDo } from "./server";


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
    const agent = agentContext.getStore();
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

async function getTopHNStoriesBR(env: Env, num: number) {
  const browserManager = new BrowserDo(env, null);
  const browser = await browserManager.initBrowser();
  
  try {
      const page = await browser.newPage();
      await page.goto('https://news.ycombinator.com');
      
      const stories = await page.evaluate(() => {
          const stories: { title: string; link: string }[] = [];
          const storyElements = document.querySelectorAll('.athing');

          storyElements.forEach((story, index) => {
              const titleElement = story.querySelector('.titleline a') as HTMLAnchorElement | null;
              const title = titleElement?.innerText.trim();
              const link = titleElement?.href;

              if (title && link) {
                  stories.push({ title, link });
              }
          });

          return stories;
      });
      
      await browser.close();
      const selectedStories = stories.slice(0, num);
      
      // Create HTML output with proper clickable links
      let htmlOutput = `<div>Here are the top ${num} Hacker News posts:</div>`;
      
      for (let i = 0; i < selectedStories.length; i++) {
          const story = selectedStories[i];
          htmlOutput += `<div>${i + 1}. <a href="${story.link}" target="_blank">${story.title}</a></div>`;
      }

      return htmlOutput;
  } catch (error) {
      await browser.close();
      throw error;
  }
}

const scrapeHackerNews = tool({
  description: "scrape top stories from Hacker News (HN)",
  parameters: z.object({
    num: z.number().describe("number of stories to retrieve").default(5),
  }),
  execute: async ({ num }) => {
    const context = agentContext.getStore();
    console.log("Context", context);
    if (!context?.env) {
      throw new Error("Browser environment not available");
    }
    console.log("Scraping HN stories...");
    const stories = await getTopHNStoriesBR(context.env, num);
    
    // Return the HTML directly without letting the AI reformat it
    return { __html: stories };  // Use __html to indicate this is raw HTML
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */

export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  scrapeHackerNews,
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