import { z } from "zod";
import { generateText, Output } from "ai";

const InsertStatementSchema = z.object({
  type: z.enum(["before", "after"]),
  index: z.number(),
});

export type InsertPosition = z.infer<typeof InsertStatementSchema>;

export async function insertStatement(
  currentStatements: string[],
  newStatement: string
): Promise<InsertPosition | null> {
  // If no existing statements, return null (will be first)
  if (currentStatements.length === 0) {
    return null;
  }

  const prompt = `Given a list of statements and a new statement, choose the most appropriate position to insert the new statement by returning an object with following format: 
  ${JSON.stringify(
    InsertStatementSchema.toJSONSchema(),
    null,
    2
  )}\n\nHere are the current statements and their indices:\n${currentStatements
    .map((statement, index) => `[${index}] ${statement}`)
    .join("\n")}\n\nHere is the new statement: ${newStatement}.`;

  console.log(prompt);

  const response = await generateText({
    model: "openai/gpt-oss-120b",
    prompt: prompt,
    output: Output.object({ schema: InsertStatementSchema }),
    providerOptions: {
      gateway: {
        order: ["cerebras"],
      },
    },
    maxRetries: 2,
  });

  return response.output;
}

/**
 * Takes the current ordered list and determines the new order after inserting
 * a new statement index at the AI-determined position.
 */
export function applyInsertPosition(
  currentOrder: number[],
  newStatementIndex: number,
  insertPosition: InsertPosition | null
): number[] {
  // If no current order or null position, just add to the end
  if (currentOrder.length === 0 || insertPosition === null) {
    return [...currentOrder, newStatementIndex];
  }

  const { type, index } = insertPosition;

  // The index from AI refers to position in currentOrder array
  if (index < 0 || index >= currentOrder.length) {
    // Invalid index, append to end
    return [...currentOrder, newStatementIndex];
  }

  const newOrder = [...currentOrder];

  if (type === "before") {
    newOrder.splice(index, 0, newStatementIndex);
  } else {
    newOrder.splice(index + 1, 0, newStatementIndex);
  }

  return newOrder;
}
