import { NextRequest, NextResponse } from "next/server";
import { put, del } from "@vercel/blob";

export async function POST(request: NextRequest) {
  try {
    const { audio } = await request.json();

    if (!audio) {
      return NextResponse.json({ error: "No audio data provided" }, { status: 400 });
    }

    const apiKey = process.env.BASETEN_API_KEY;
    if (!apiKey) {
      console.error("BASETEN_API_KEY not configured");
      return NextResponse.json({ error: "Transcription service not configured" }, { status: 500 });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, "base64");

    // Upload to Vercel Blob (temporary storage)
    const filename = `audio-${Date.now()}.webm`;
    const blob = await put(filename, audioBuffer, {
      access: "public",
      contentType: "audio/webm",
    });
    console.log("Uploaded audio to:", blob.url, "size:", audioBuffer.length, "bytes");

    try {
      // Call Baseten with the public URL
      const response = await fetch(
        "https://model-7wl84pe3.api.baseten.co/environments/production/predict",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Api-Key ${apiKey}`,
          },
          body: JSON.stringify({
            whisper_input: {
              audio: {
                url: blob.url,
              },
              whisper_params: {
                audio_language: "auto",
              },
            },
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Baseten API error:", response.status, errorText);
        return NextResponse.json(
          { error: "Transcription failed" },
          { status: response.status }
        );
      }

      const data = await response.json();

      // Baseten Whisper returns segments array with text in each segment
      const transcription = data.segments
        ?.map((seg: { text: string }) => seg.text)
        .join(" ")
        .trim() || "";

      return NextResponse.json({ transcription });
    } finally {
      // Clean up: delete the temporary blob
      await del(blob.url).catch((err) => {
        console.error("Failed to delete temporary blob:", err);
      });
    }
  } catch (error) {
    console.error("Transcription error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
