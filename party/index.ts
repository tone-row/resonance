import { Connection, routePartykitRequest, Server } from "partyserver";
import {
  initializeSession,
  sessionReducer,
  getUnresolvedStatements,
  isStatementResolved,
  type Session,
} from "../lib/session";
import { insertStatement, applyInsertPosition } from "../lib/insertStatement";
import { generateNegation } from "../lib/generateNegation";

export class ResonanceServer extends Server {
  options = {
    hibernate: true, // Enable hibernation for longer room persistence
  };

  private pendingRemovals: Map<string, number> = new Map(); // Use number for CloudFlare timer IDs
  private sessionState: Session | null = null;

  async onConnect(conn: Connection) {
    console.log(`User ${conn.id} connected to room ${this.name}`);

    // Cancel any pending removal for this user (they're reconnecting)
    if (conn.id && this.pendingRemovals.has(conn.id)) {
      const timeoutId = this.pendingRemovals.get(conn.id)!;
      clearTimeout(timeoutId);
      this.pendingRemovals.delete(conn.id);
      console.log(
        `🔄 Cancelled pending removal for user ${conn.id} (quick reconnect)`
      );
    }

    // Initialize session if it doesn't exist
    if (!this.sessionState) {
      this.sessionState = initializeSession();
      console.log(
        `Initialized new session for room ${this.name}:`,
        this.sessionState
      );
    }

    let session = this.sessionState;

    // If user has an ID and there are statements, add them to all unresolved statements
    if (conn.id && session && session.statements.length > 0) {
      // Get unresolved statements before adding the user
      const unresolvedStatements = getUnresolvedStatements(session);
      const unresolvedStatementTexts = unresolvedStatements.map((stmt) => ({
        index: session!.statements.indexOf(stmt),
        text: stmt.text.substring(0, 50) + (stmt.text.length > 50 ? "..." : ""),
        createdBy: stmt.createdBy,
        presentUsers: stmt.present,
      }));

      console.log(`🔗 User ${conn.id} joining room ${this.name}`);
      console.log(
        `📝 Found ${unresolvedStatements.length} unresolved statements:`
      );
      unresolvedStatementTexts.forEach((stmt) => {
        console.log(
          `   Statement ${stmt.index}: "${stmt.text}" by ${
            stmt.createdBy
          }, present: [${stmt.presentUsers.join(", ")}]`
        );
      });

      const updatedSession = sessionReducer(session, {
        type: "UPDATE_UNRESOLVED_STATEMENTS",
        payload: {
          userId: conn.id,
          action: "add",
        },
      });

      if (JSON.stringify(updatedSession) !== JSON.stringify(session)) {
        session = updatedSession;
        this.sessionState = session;

        // Log what changed
        const updatedUnresolvedStatements = getUnresolvedStatements(session);
        const updatedStatementTexts = updatedUnresolvedStatements.map(
          (stmt) => ({
            index: session!.statements.indexOf(stmt),
            text:
              stmt.text.substring(0, 50) + (stmt.text.length > 50 ? "..." : ""),
            createdBy: stmt.createdBy,
            presentUsers: stmt.present,
          })
        );

        console.log(
          `✅ Added user ${conn.id} to unresolved statements. Updated statements:`
        );
        updatedStatementTexts.forEach((stmt) => {
          console.log(
            `   Statement ${stmt.index}: "${stmt.text}" by ${
              stmt.createdBy
            }, present: [${stmt.presentUsers.join(", ")}]`
          );
        });

        // Broadcast updated session to all connections
        this.broadcast(
          JSON.stringify({
            type: "session_state",
            session: session,
          })
        );
      } else {
        console.log(
          `⚠️  No changes needed - user ${conn.id} already in all unresolved statements or no unresolved statements`
        );
      }
    } else {
      console.log(
        `ℹ️  User ${conn.id} joining - no statements exist yet or no user ID`
      );
    }

    // Send current session state to new connection
    conn.send(
      JSON.stringify({
        type: "session_state",
        session: session,
      })
    );
  }

  async onMessage(connection: Connection, message: string) {
    console.log(`Received message from ${connection.id}:`, message);

    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case "get_session":
          if (this.sessionState) {
            connection.send(
              JSON.stringify({
                type: "session_state",
                session: this.sessionState,
              })
            );
            console.log(
              `Sent session state to ${connection.id}:`,
              this.sessionState
            );
          }
          break;

        case "add_statement":
          await this.handleAddStatement(data.payload);
          break;

        case "vote_response":
          await this.handleVoteResponse(data.payload);
          break;

        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  }

  async handleAddStatement(payload: { text: string; userId: string }) {
    // Get current session
    let session = this.sessionState;
    if (!session) {
      session = initializeSession();
      this.sessionState = session;
    }

    // Get list of currently connected users
    const connections = [...this.getConnections()];
    const presentUsers = connections.map((conn) => conn.id).filter(Boolean);

    console.log(
      `Adding statement "${payload.text}" by ${payload.userId}, present users:`,
      presentUsers
    );

    // Generate the negation for this statement
    console.log(`🔄 Generating negation for: "${payload.text}"`);
    const negation = await generateNegation(payload.text);
    const negationFirst = Math.random() > 0.5;
    console.log(`✅ Generated negation: "${negation}" (negationFirst: ${negationFirst})`);

    // Add statement with present users and negation
    const updatedSession = sessionReducer(session, {
      type: "ADD_STATEMENT",
      payload: {
        text: payload.text,
        negation: negation,
        negationFirst: negationFirst,
        createdBy: payload.userId,
        presentUsers: presentUsers,
      },
    });

    // Auto-approve the creator
    const statementIndex = updatedSession.statements.length - 1;
    let finalSession = sessionReducer(updatedSession, {
      type: "RESPOND_TO_STATEMENT",
      payload: {
        statementIndex: statementIndex,
        userId: payload.userId,
        response: true,
      },
    });

    // Check if statement is immediately ratified (e.g., creator is only present user)
    const statement = finalSession.statements[statementIndex];
    if (statement && isStatementResolved(statement)) {
      const allAgreed = Object.values(statement.responses).every(
        (r) => r === true
      );
      if (allAgreed) {
        console.log(
          `🎉 Statement ${statementIndex} immediately ratified! Determining semantic position...`
        );
        finalSession = await this.handleStatementRatified(
          finalSession,
          statementIndex
        );
      }
    }

    // Save updated session
    this.sessionState = finalSession;
    console.log(`Session updated:`, finalSession);

    // Broadcast to all connections
    this.broadcast(
      JSON.stringify({
        type: "session_state",
        session: finalSession,
      })
    );
  }

  async handleVoteResponse(payload: {
    statementIndex: number;
    userId: string;
    response: boolean;
  }) {
    // Get current session
    const session = this.sessionState;
    if (!session) return;

    console.log(
      `Vote from ${payload.userId} on statement ${payload.statementIndex}: ${payload.response}`
    );

    // Check if statement was resolved before this vote
    const statementBeforeVote = session.statements[payload.statementIndex];
    const wasResolved = statementBeforeVote
      ? isStatementResolved(statementBeforeVote)
      : false;

    // Apply the vote using our session reducer
    let updatedSession = sessionReducer(session, {
      type: "RESPOND_TO_STATEMENT",
      payload: {
        statementIndex: payload.statementIndex,
        userId: payload.userId,
        response: payload.response,
      },
    });

    // Check if this vote caused the statement to become ratified (resolved with all "yes")
    const statementAfterVote =
      updatedSession.statements[payload.statementIndex];
    const isNowResolved = statementAfterVote
      ? isStatementResolved(statementAfterVote)
      : false;
    const allAgreed = statementAfterVote
      ? Object.values(statementAfterVote.responses).every((r) => r === true)
      : false;

    // If statement just became ratified, determine its semantic position
    if (!wasResolved && isNowResolved && allAgreed) {
      console.log(
        `🎉 Statement ${payload.statementIndex} was ratified! Determining semantic position...`
      );

      updatedSession = await this.handleStatementRatified(
        updatedSession,
        payload.statementIndex
      );
    }

    // Save updated session
    this.sessionState = updatedSession;
    console.log(`Session updated after vote:`, updatedSession);

    // Broadcast to all connections
    this.broadcast(
      JSON.stringify({
        type: "session_state",
        session: updatedSession,
      })
    );
  }

  private async handleStatementRatified(
    session: Session,
    statementIndex: number
  ): Promise<Session> {
    const statement = session.statements[statementIndex];
    if (!statement) return session;

    try {
      // Get current ratified statements in their semantic order
      const currentRatifiedTexts = (session.ratifiedOrder || [])
        .filter((idx) => idx >= 0 && idx < session.statements.length)
        .map((idx) => session.statements[idx].text);

      console.log(
        `📝 Current ratified statements (${currentRatifiedTexts.length}):`,
        currentRatifiedTexts
      );
      console.log(`📝 New statement to insert: "${statement.text}"`);

      // Ask AI where to insert the new statement (uses Vercel AI Gateway)
      const insertPosition = await insertStatement(
        currentRatifiedTexts,
        statement.text
      );

      console.log(`🤖 AI determined insert position:`, insertPosition);

      // Apply the insert position to get new order
      const newRatifiedOrder = applyInsertPosition(
        session.ratifiedOrder || [],
        statementIndex,
        insertPosition
      );

      console.log(`📋 New ratified order:`, newRatifiedOrder);

      return {
        ...session,
        ratifiedOrder: newRatifiedOrder,
      };
    } catch (error) {
      console.error("❌ Error determining statement position:", error);
      // Fallback: append to end
      return {
        ...session,
        ratifiedOrder: [...(session.ratifiedOrder || []), statementIndex],
      };
    }
  }

  async onClose(connection: Connection) {
    console.log(`User ${connection.id} disconnected from room ${this.name}`);

    if (!connection.id) return;

    // Set a 5-second timeout before removing the user
    // This allows for quick reconnects (like page refreshes) without disrupting statements
    console.log(
      `⏰ Setting 5-second timeout before removing user ${connection.id}`
    );

    const timeoutId = setTimeout(async () => {
      await this.removeUserFromStatements(connection.id!);
      this.pendingRemovals.delete(connection.id!);
    }, 5000);

    this.pendingRemovals.set(connection.id, timeoutId as unknown as number);
  }

  private async removeUserFromStatements(userId: string) {
    console.log(
      `🗑️ Timeout expired - removing user ${userId} from unresolved statements`
    );

    const session = this.sessionState;
    if (!session) return;

    // Track which statements were unresolved before
    const unresolvedBefore = new Set(
      session.statements
        .map((stmt, idx) => ({ stmt, idx }))
        .filter(({ stmt }) => !isStatementResolved(stmt))
        .map(({ idx }) => idx)
    );

    let updatedSession = sessionReducer(session, {
      type: "UPDATE_UNRESOLVED_STATEMENTS",
      payload: {
        userId: userId,
        action: "remove",
      },
    });

    // Check if any statements became ratified due to user leaving
    for (const stmtIndex of unresolvedBefore) {
      const statement = updatedSession.statements[stmtIndex];
      if (!statement) continue;

      const isNowResolved = isStatementResolved(statement);
      const allAgreed = Object.values(statement.responses).every(
        (r) => r === true
      );
      const alreadyInOrder = (updatedSession.ratifiedOrder || []).includes(
        stmtIndex
      );

      if (isNowResolved && allAgreed && !alreadyInOrder) {
        console.log(
          `🎉 Statement ${stmtIndex} was ratified after user left! Determining semantic position...`
        );
        updatedSession = await this.handleStatementRatified(
          updatedSession,
          stmtIndex
        );
      }
    }

    if (JSON.stringify(updatedSession) !== JSON.stringify(session)) {
      this.sessionState = updatedSession;
      console.log(
        `Removed user ${userId} from unresolved statements:`,
        updatedSession
      );

      // Broadcast updated session to remaining connections
      this.broadcast(
        JSON.stringify({
          type: "session_state",
          session: updatedSession,
        })
      );
    } else {
      console.log(`No changes needed when removing user ${userId}`);
    }
  }

  onError(connection: Connection, error: Error) {
    console.error(`Error for connection ${connection.id}:`, error);
  }
}

export default {
  fetch(request: Request, env: Record<string, unknown>) {
    console.log(`🌐 [WORKER] ${request.method} request to ${request.url}`);
    console.log(`🌐 [WORKER] Environment bindings:`, Object.keys(env));
    console.log(
      `🌐 [WORKER] Headers:`,
      Object.fromEntries(request.headers.entries())
    );

    try {
      const response = routePartykitRequest(request, env);
      if (response) {
        console.log(`✅ [WORKER] Routed successfully`);
        return response;
      } else {
        console.log(`⚠️ [WORKER] No route found`);
        return new Response("Not Found", { status: 404 });
      }
    } catch (error) {
      console.error(`❌ [WORKER] Error in routePartykitRequest:`, error);
      return new Response(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        { status: 500 }
      );
    }
  },
};
