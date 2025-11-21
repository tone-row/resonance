"use client";

import { useParams } from "next/navigation";
import { useUserId } from "@/hooks/useUserId";
import { usePartySocket } from "partysocket/react";
import { useEffect, useState, useMemo } from "react";
import {
  type Session,
  getResolvedStatementsWhereEveryoneAgreed,
  getLiveStatement,
} from "@/lib/session";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const userId = useUserId();
  const [session, setSession] = useState<Session | null>(null);
  const [statementText, setStatementText] = useState("");

  const liveStatement = useMemo(() => {
    return session ? getLiveStatement(session) : null;
  }, [session]);

  const hasUserVoted = useMemo(() => {
    if (!liveStatement || !userId) return false;
    return userId in liveStatement.responses;
  }, [liveStatement, userId]);

  const agreedStatements = useMemo(() => {
    return session ? getResolvedStatementsWhereEveryoneAgreed(session) : [];
  }, [session]);

  const handleVote = (response: boolean) => {
    if (!socket || !userId || !session || !liveStatement) return;

    // Find the statement index in the session
    const statementIndex = session.statements.indexOf(liveStatement);
    if (statementIndex === -1) return;

    socket.send(
      JSON.stringify({
        type: "vote_response",
        payload: {
          statementIndex,
          userId,
          response,
        },
      })
    );
  };

  const socket = usePartySocket({
    host: process.env.NODE_ENV === 'production'
      ? "resonance-party.tone-row.workers.dev"
      : "127.0.0.1:1999",
    room: roomId,
    id: userId!,
    // Only create socket connection when we have a userId
    startClosed: !userId,
  });

  useEffect(() => {
    if (!socket) return;

    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("Received from server:", data);

        if (data.type === "session_state") {
          setSession(data.session);
          console.log("Session state updated:", data.session);
        }
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    });

    // Request initial session state when connected
    socket.addEventListener("open", () => {
      console.log("Connected to room:", roomId);
      socket.send(JSON.stringify({ type: "get_session" }));
    });
  }, [socket, roomId]);

  const handleAddStatement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!statementText.trim() || !socket || !userId) return;

    socket.send(
      JSON.stringify({
        type: "add_statement",
        payload: {
          text: statementText.trim(),
          userId: userId,
        },
      })
    );

    setStatementText("");
  };

  if (!userId) {
    return <div>Loading user...</div>;
  }

  return (
    <main className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_300px]">
      <form onSubmit={handleAddStatement} className="p-4">
        <div className="flex gap-2">
          <Input
            type="text"
            name="statement"
            id="statement"
            data-1p-ignore
            value={statementText}
            onChange={(e) => setStatementText(e.target.value)}
            placeholder="Add a statement to the queue..."
            autoComplete="off"
            className="border-neutral-400 bg-neutral-50"
          />
          <Button type="submit" disabled={!statementText.trim()}>
            Add
          </Button>
        </div>
      </form>

      <div className="grid place-items-center">
        <AnimatePresence mode="wait">
          {liveStatement ? (
            <motion.div
              key={liveStatement.text}
              initial={{
                opacity: 0,
                y: 20,
                filter: "blur(8px) brightness(0.6)",
                scale: 0.95,
              }}
              animate={{
                opacity: 1,
                y: 0,
                filter: "blur(0px) brightness(1)",
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: -20,
                filter: "blur(4px) brightness(0.8)",
                scale: 1.05,
              }}
              transition={{
                duration: 1.2,
                ease: [0.25, 0.46, 0.45, 0.94],
                filter: { duration: 1.4 },
                scale: { duration: 1.0 },
              }}
            >
              <motion.p
                className="text-3xl font-serif text-balance text-gray-800 dark:text-gray-200 mb-4 text-center"
                initial={{ filter: "blur(12px)" }}
                animate={{ filter: "blur(0px)" }}
                transition={{ duration: 1.8, delay: 0.3 }}
              >
                {liveStatement.text}
              </motion.p>
              <motion.div
                className="flex gap-4 justify-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.8 }}
              >
                <Button
                  onClick={() => handleVote(true)}
                  disabled={hasUserVoted}
                  variant="green"
                >
                  Agree
                </Button>
                <Button
                  onClick={() => handleVote(false)}
                  disabled={hasUserVoted}
                  variant="red"
                >
                  Disagree
                </Button>
              </motion.div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              transition={{ duration: 1.0 }}
            >
              No Live Statement
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* <div className="grid border-t border-zinc-200 overflow-y-auto p-4">
        <div className="space-y-3">
          {agreedStatements.map((statement, index) => (
            <div
              key={`${statement.text}-${index}`}
              className="p-4 bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg"
            >
              <p className="text-gray-800 dark:text-gray-200">
                {statement.text}
              </p>
            </div>
          ))}
        </div>
      </div> */}

      <div className="border-t overflow-y p-4 font-serif text-2xl bg-foreground text-background">
        <AnimatePresence>
          {agreedStatements.map((statement, index) => {
            const lastChar = statement.text.slice(-1);
            const displayText =
              lastChar === "." || lastChar === "?" || lastChar === "!"
                ? statement.text
                : statement.text + ".";

            return (
              <motion.span
                key={`${statement.text}-${index}`}
                initial={{
                  opacity: 0,
                  filter: "blur(8px)",
                  y: 10,
                  scale: 0.98,
                }}
                animate={{
                  opacity: 1,
                  filter: "blur(0px)",
                  y: 0,
                  scale: 1,
                }}
                transition={{
                  duration: 2.5,
                  ease: [0.23, 1, 0.32, 1],
                  filter: { duration: 3.0 },
                  delay: index * 0.1, // Stagger animation for each new statement
                }}
                className="inline"
              >
                {displayText}
                {index < agreedStatements.length - 1 && " "}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>

      {/* <div className="text-[10px] text-zinc-500 bg-zinc-50 border border-zinc-200 absolute bottom-1 right-1 p-2 font-mono not-mobile:hidden">
        <p>Your ID: {userId}</p>
        <p>
          Connection:{" "}
          {socket?.readyState === WebSocket.OPEN
            ? "Connected"
            : "Connecting..."}
        </p>
        {session && (
          <p>Session loaded: {session.statements.length} statements</p>
        )}
      </div> */}
    </main>
  );
}
