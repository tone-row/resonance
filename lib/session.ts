import { z } from 'zod';

export const StatementSchema = z.object({
  text: z.string(),
  createdBy: z.string(),
  present: z.array(z.string()),
  responses: z.record(z.string(), z.boolean())
});

export const SessionSchema = z.object({
  statements: z.array(StatementSchema),
  liveStatementIndex: z.number().nullable(),
  // Ordered array of statement indices that have been ratified (everyone agreed)
  // The order is determined semantically by AI to create a coherent narrative
  ratifiedOrder: z.array(z.number()).default([])
});

export type Statement = z.infer<typeof StatementSchema>;
export type Session = z.infer<typeof SessionSchema>;

export type AddStatementAction = {
  type: 'ADD_STATEMENT';
  payload: {
    text: string;
    createdBy: string;
    presentUsers: string[];
  };
};

export type RespondToStatementAction = {
  type: 'RESPOND_TO_STATEMENT';
  payload: {
    statementIndex: number;
    userId: string;
    response: boolean;
  };
};

export type UpdateUnresolvedStatementsAction = {
  type: 'UPDATE_UNRESOLVED_STATEMENTS';
  payload: {
    userId: string;
    action: 'add' | 'remove';
  };
};

export type SessionAction = AddStatementAction | RespondToStatementAction | UpdateUnresolvedStatementsAction;

export function initializeSession(): Session {
  return {
    statements: [],
    liveStatementIndex: null,
    ratifiedOrder: []
  };
}

export function isStatementResolved(statement: Statement): boolean {
  const responseCount = Object.keys(statement.responses).length;
  const presentCount = statement.present.length;
  return responseCount === presentCount;
}

export function getUnresolvedStatements(session: Session): Statement[] {
  return session.statements.filter(statement => !isStatementResolved(statement));
}

export function getResolvedStatementsWhereEveryoneAgreed(session: Session): Statement[] {
  // Use the ratifiedOrder if available for semantic ordering
  if (session.ratifiedOrder && session.ratifiedOrder.length > 0) {
    return session.ratifiedOrder
      .filter(index => index >= 0 && index < session.statements.length)
      .map(index => session.statements[index])
      .filter(statement => {
        // Verify it's still a valid ratified statement
        if (!isStatementResolved(statement)) return false;
        const responses = Object.values(statement.responses);
        return responses.length > 0 && responses.every(response => response === true);
      });
  }

  // Fallback to chronological order if no ratifiedOrder exists
  return session.statements
    .filter(statement => {
      // Must be resolved
      if (!isStatementResolved(statement)) return false;

      // Must have responses (shouldn't happen if resolved, but safety check)
      const responses = Object.values(statement.responses);
      if (responses.length === 0) return false;

      // Everyone must have agreed (all responses are true)
      return responses.every(response => response === true);
    }); // Chronological order (oldest first) to create a flowing paragraph
}

export function getLiveStatement(session: Session): Statement | null {
  if (session.liveStatementIndex === null) return null;
  if (session.liveStatementIndex >= session.statements.length) return null;
  return session.statements[session.liveStatementIndex];
}

function selectNextLiveStatementIndex(session: Session): number | null {
  const unresolvedStatements = getUnresolvedStatements(session);
  if (unresolvedStatements.length === 0) return null;

  // Count resolved statements by creator
  const resolvedStatements = session.statements.filter(isStatementResolved);
  const resolvedCountByCreator = new Map<string, number>();

  for (const statement of resolvedStatements) {
    const current = resolvedCountByCreator.get(statement.createdBy) || 0;
    resolvedCountByCreator.set(statement.createdBy, current + 1);
  }

  // Sort unresolved statements by creator's resolved count (ascending), then by original order
  const sortedUnresolvedStatements = [...unresolvedStatements].sort((a, b) => {
    const aCreatorCount = resolvedCountByCreator.get(a.createdBy) || 0;
    const bCreatorCount = resolvedCountByCreator.get(b.createdBy) || 0;

    if (aCreatorCount !== bCreatorCount) {
      return aCreatorCount - bCreatorCount; // Prioritize creators with fewer resolved statements
    }

    // If equal resolved counts, maintain original order
    return session.statements.indexOf(a) - session.statements.indexOf(b);
  });

  const nextStatement = sortedUnresolvedStatements[0];
  return session.statements.indexOf(nextStatement);
}

export function sessionReducer(session: Session, action: SessionAction): Session {
  switch (action.type) {
    case 'ADD_STATEMENT':
      const updatedSessionWithStatement = {
        ...session,
        statements: [
          ...session.statements,
          {
            text: action.payload.text,
            createdBy: action.payload.createdBy,
            present: action.payload.presentUsers,
            responses: {}
          }
        ]
      };

      // Set live statement if none exists
      return {
        ...updatedSessionWithStatement,
        liveStatementIndex: session.liveStatementIndex !== null
          ? session.liveStatementIndex
          : selectNextLiveStatementIndex(updatedSessionWithStatement)
      };

    case 'RESPOND_TO_STATEMENT':
      const { statementIndex, userId, response } = action.payload;

      if (statementIndex < 0 || statementIndex >= session.statements.length) {
        throw new Error('Invalid statement index');
      }

      const updatedSessionWithResponse = {
        ...session,
        statements: session.statements.map((statement, index) =>
          index === statementIndex
            ? {
                ...statement,
                responses: {
                  ...statement.responses,
                  [userId]: response
                }
              }
            : statement
        )
      };

      // Check if the statement we just responded to is now resolved
      const updatedStatement = updatedSessionWithResponse.statements[statementIndex];
      const isNowResolved = isStatementResolved(updatedStatement);

      // If the resolved statement was the live statement, select a new one
      const newLiveStatementIndex = (isNowResolved && session.liveStatementIndex === statementIndex)
        ? selectNextLiveStatementIndex(updatedSessionWithResponse)
        : session.liveStatementIndex;

      return {
        ...updatedSessionWithResponse,
        liveStatementIndex: newLiveStatementIndex
      };

    case 'UPDATE_UNRESOLVED_STATEMENTS':
      const { userId: targetUserId, action: updateAction } = action.payload;

      const updatedSessionWithUserChanges = {
        ...session,
        statements: session.statements.map(statement => {
          // Only update unresolved statements
          if (isStatementResolved(statement)) {
            return statement;
          }

          if (updateAction === 'add') {
            // Add user to present array if not already there
            if (!statement.present.includes(targetUserId)) {
              return {
                ...statement,
                present: [...statement.present, targetUserId]
              };
            }
          } else if (updateAction === 'remove') {
            // Never remove the statement creator from their own statement
            if (statement.createdBy === targetUserId) {
              return statement;
            }

            // Remove user from present array and their response
            const { [targetUserId]: _removedResponse, ...remainingResponses } = statement.responses;
            return {
              ...statement,
              present: statement.present.filter(id => id !== targetUserId),
              responses: remainingResponses
            };
          }

          return statement;
        })
      };

      // Check if any statements became resolved due to user changes
      let needsNewLiveStatement = false;
      if (session.liveStatementIndex !== null) {
        const currentLiveStatement = updatedSessionWithUserChanges.statements[session.liveStatementIndex];
        if (currentLiveStatement && isStatementResolved(currentLiveStatement)) {
          needsNewLiveStatement = true;
        }
      }

      // Select new live statement if current one was resolved or if none exists
      const updatedLiveStatementIndex = needsNewLiveStatement || session.liveStatementIndex === null
        ? selectNextLiveStatementIndex(updatedSessionWithUserChanges)
        : session.liveStatementIndex;

      return {
        ...updatedSessionWithUserChanges,
        liveStatementIndex: updatedLiveStatementIndex
      };

    default:
      return session;
  }
}