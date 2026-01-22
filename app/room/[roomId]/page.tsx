"use client";

import { useParams } from "next/navigation";
import { useUserId } from "@/hooks/useUserId";
import { usePartySocket } from "partysocket/react";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { type Session, getLiveStatement } from "@/lib/session";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Mic, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { TypewriterSpan } from "@/components/TypewriterSpan";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.roomId as string;
  const userId = useUserId();
  const [session, setSession] = useState<Session | null>(null);
  const [statementText, setStatementText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const liveStatement = useMemo(() => {
    return session ? getLiveStatement(session) : null;
  }, [session]);

  const hasUserVoted = useMemo(() => {
    if (!liveStatement || !userId) return false;
    return userId in liveStatement.responses;
  }, [liveStatement, userId]);

  // Track which statement indices we've already seen (for typewriter effect)
  const seenStatementsRef = useRef<Set<number>>(new Set());

  // Get ratified statements with their original indices for stable keys
  const ratifiedStatementsWithIndices = useMemo(() => {
    if (!session) return [];

    const order = session.ratifiedOrder || [];
    return order
      .filter((idx) => idx >= 0 && idx < session.statements.length)
      .map((originalIndex) => ({
        originalIndex,
        statement: session.statements[originalIndex],
      }))
      .filter(({ statement }) => {
        // Verify it's still ratified
        const responses = Object.values(statement.responses);
        const presentCount = statement.present.length;
        const isResolved = responses.length === presentCount;
        return (
          isResolved &&
          responses.length > 0 &&
          responses.every((r) => r === true)
        );
      });
  }, [session]);

  // Determine which statements are new (for typewriter effect)
  const newStatementIndices = useMemo(() => {
    const currentIndices = new Set(
      ratifiedStatementsWithIndices.map((s) => s.originalIndex)
    );
    const newOnes = new Set<number>();

    for (const idx of currentIndices) {
      if (!seenStatementsRef.current.has(idx)) {
        newOnes.add(idx);
      }
    }

    // Update seen set after computing new ones
    seenStatementsRef.current = currentIndices;

    return newOnes;
  }, [ratifiedStatementsWithIndices]);

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
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
    party: "resonance-server",
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

    const lines = statementText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    for (const line of lines) {
      socket.send(
        JSON.stringify({
          type: "add_statement",
          payload: {
            text: line,
            userId: userId,
          },
        })
      );
    }

    setStatementText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddStatement(e as unknown as React.FormEvent);
    }
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all tracks to release the microphone
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(",")[1];

          setIsProcessing(true);
          try {
            const response = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: base64 }),
            });

            if (response.ok) {
              const { transcription } = await response.json();
              if (transcription) {
                setStatementText(transcription);
              }
            }
          } catch {
            // Silently fail as per user request
          } finally {
            setIsProcessing(false);
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      // Silently fail - user may have denied microphone access
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }, []);

  if (!userId) {
    return <div>Loading user...</div>;
  }

  return (
    <main className="grid h-dvh grid-rows-[minmax(0,1fr)_300px] md:grid-rows-none md:grid-cols-2">
      <div className="relative grid place-items-center">
        <form
          onSubmit={handleAddStatement}
          className="absolute top-0 left-0 right-0 p-4"
        >
          <div className="flex flex-col gap-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Textarea
                  name="statement"
                  id="statement"
                  data-1p-ignore
                  value={statementText}
                  onChange={(e) => setStatementText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Add a statement to the queue..."
                  autoComplete="off"
                  rows={2}
                  className="border-neutral-400 bg-neutral-50 pr-10 resize-none"
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onMouseDown={!isProcessing ? startRecording : undefined}
                      onMouseUp={!isProcessing ? stopRecording : undefined}
                      onMouseLeave={!isProcessing ? stopRecording : undefined}
                      onTouchStart={!isProcessing ? startRecording : undefined}
                      onTouchEnd={!isProcessing ? stopRecording : undefined}
                      disabled={isProcessing}
                      className={`absolute right-2 top-2 size-7 flex items-center justify-center rounded transition-colors ${
                        isRecording
                          ? "bg-red-500 hover:bg-red-600"
                          : isProcessing
                          ? "bg-neutral-300 dark:bg-neutral-600 cursor-wait"
                          : "bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"
                      }`}
                    >
                      {isProcessing ? (
                        <Loader2 className="size-4 text-neutral-500 dark:text-neutral-400 animate-spin" />
                      ) : (
                        <Mic className={`size-4 ${isRecording ? "text-white" : "text-neutral-600 dark:text-neutral-300"}`} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {isProcessing ? "Transcribing..." : isRecording ? "Recording..." : "Press and hold to record"}
                  </TooltipContent>
                </Tooltip>
              </div>
              <Button type="submit" disabled={!statementText.trim()}>
                Add
              </Button>
            </div>
            <p className="text-xs text-neutral-500">
              Enter to submit, Shift+Enter for new line. Each line becomes a separate statement.
            </p>
          </div>
        </form>

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
              className="px-8 w-full max-w-2xl"
            >
              <motion.p
                className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5 }}
              >
                Choose the statement you agree with
              </motion.p>
              <motion.div
                className="flex flex-col gap-4"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3 }}
              >
                {(() => {
                  const statementText = liveStatement.text;
                  const negationText = liveStatement.negation || `Not: ${liveStatement.text}`;
                  const showNegationFirst = liveStatement.negationFirst ?? false;

                  const firstText = showNegationFirst ? negationText : statementText;
                  const secondText = showNegationFirst ? statementText : negationText;
                  const firstVote = showNegationFirst ? false : true;
                  const secondVote = showNegationFirst ? true : false;

                  const buttonClass = "p-6 text-xl font-serif text-balance text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-left";

                  return (
                    <>
                      <button
                        onClick={() => handleVote(firstVote)}
                        disabled={hasUserVoted}
                        className={buttonClass}
                      >
                        {firstText}
                      </button>
                      <p className="text-center text-gray-400 dark:text-gray-500 text-sm">or</p>
                      <button
                        onClick={() => handleVote(secondVote)}
                        disabled={hasUserVoted}
                        className={buttonClass}
                      >
                        {secondText}
                      </button>
                    </>
                  );
                })()}
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

      <div className="border-t md:border-t-0 md:border-l overflow-y-auto p-8 font-serif text-xl leading-8 bg-neutral-50 text-neutral-900 dark:text-white">
        {ratifiedStatementsWithIndices.map(
          ({ originalIndex, statement }, displayIndex) => {
            const lastChar = statement.text.slice(-1);
            const displayText =
              lastChar === "." || lastChar === "?" || lastChar === "!"
                ? statement.text
                : statement.text + ".";

            const isNew = newStatementIndices.has(originalIndex);
            const suffix =
              displayIndex < ratifiedStatementsWithIndices.length - 1
                ? " "
                : "";

            return (
              <span key={originalIndex} className="inline">
                {isNew ? (
                  <TypewriterSpan
                    text={displayText}
                    speed={25}
                    animate={true}
                  />
                ) : (
                  displayText
                )}
                {suffix}
              </span>
            );
          }
        )}
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
