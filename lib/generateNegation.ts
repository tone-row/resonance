import { generateText, Output } from "ai";
import { z } from "zod";

export async function generateNegation(statement: string): Promise<string> {
  try {
    const schema = z.object({
      negative_sentence: z.string(),
    });

    const result = await generateText({
      model: "meta/llama-3.3-70b",
      providerOptions: {
        gateway: {
          order: ["cerebras"]
        }
      },
      prompt: `Given the following statement, return its most natural negation for people who disagree.

  Statement: ${statement}`,
      output: Output.object({ schema }),
    });

    return result.output.negative_sentence;

  } catch (error) {
    console.error("Error generating negative sentence:", error);
    // Fallback: simple negation prefix
    return `Not: ${statement}`;
  }
}
