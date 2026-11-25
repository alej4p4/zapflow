import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * Computes integer duration (seconds) and a 64-bar WhatsApp PTT waveform (0..100)
 * by decoding the audio to 16-bit mono PCM via ffmpeg-static.
 */
async function extractWaveformAndDuration(
    ffmpegPath: string,
    filePath: string
): Promise<{ seconds?: number; waveform?: Uint8Array }> {
    try {
        const { stdout } = await execFileAsync(
            ffmpegPath,
            ["-v", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
            { encoding: "buffer", maxBuffer: 25 * 1024 * 1024 }
        );
        const pcmBuf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
        const totalSamples = Math.floor(pcmBuf.length / 2);
        if (totalSamples <= 0) return {};

        const seconds = Math.max(1, Math.round(totalSamples / 16000));
        const bars = 64;
        const blockSize = Math.max(1, Math.floor(totalSamples / bars));
        const amplitudes: number[] = [];

        for (let i = 0; i < bars; i++) {
            const start = i * blockSize;
            const end = Math.min(totalSamples, start + blockSize);
            let sum = 0;
            let count = 0;
            for (let j = start; j < end; j++) {
                sum += Math.abs(pcmBuf.readInt16LE(j * 2)) / 32768;
                count++;
            }
            amplitudes.push(count > 0 ? sum / count : 0);
        }

        const maxAmp = Math.max(...amplitudes, 0);
        const multiplier = maxAmp > 0 ? 1 / maxAmp : 0;
        const waveform = new Uint8Array(
            amplitudes.map((n) => Math.min(100, Math.max(0, Math.floor(100 * n * multiplier))))
        );

        return { seconds, waveform };
    } catch (err) {
        console.error("[AudioConvert] Failed to extract waveform:", err);
        return {};
    }
}

/**
 * Converts an audio buffer (e.g. browser-recorded WebM/MP4/WAV) to WhatsApp-compatible
 * OGG/Opus (`OggS`) format so voice notes (`ptt: true`) deliver and play reliably.
 */
export async function ensureOggOpusAudio(
    inputBuffer: Buffer,
    inputMimetype?: string
): Promise<{ buffer: Buffer; mimetype: string; converted: boolean; seconds?: number; waveform?: Uint8Array }> {
    const isAlreadyOgg =
        inputBuffer.length >= 4 &&
        inputBuffer.subarray(0, 4).toString("ascii") === "OggS";

    let ffmpegPath: string | null = null;
    try {
        const mod = await import("ffmpeg-static");
        ffmpegPath = (mod.default || mod) as unknown as string;
    } catch {
        ffmpegPath = null;
    }

    if (!ffmpegPath) {
        return {
            buffer: inputBuffer,
            mimetype: isAlreadyOgg ? "audio/ogg; codecs=opus" : (inputMimetype || "audio/ogg; codecs=opus"),
            converted: false,
        };
    }

    const lower = (inputMimetype || "").toLowerCase();
    const inExt = isAlreadyOgg
        ? "ogg"
        : lower.includes("webm")
          ? "webm"
          : lower.includes("mp4") || lower.includes("m4a")
            ? "m4a"
            : lower.includes("wav")
              ? "wav"
              : lower.includes("mpeg") || lower.includes("mp3")
                ? "mp3"
                : "bin";

    const tmpId = `wa-voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inPath = path.join(os.tmpdir(), `${tmpId}.${inExt}`);
    const outPath = path.join(os.tmpdir(), `${tmpId}.ogg`);

    try {
        await fs.writeFile(inPath, inputBuffer);

        if (isAlreadyOgg) {
            const meta = await extractWaveformAndDuration(ffmpegPath, inPath);
            return {
                buffer: inputBuffer,
                mimetype: "audio/ogg; codecs=opus",
                converted: false,
                ...meta,
            };
        }

        await execFileAsync(ffmpegPath, [
            "-y",
            "-i",
            inPath,
            "-vn",
            "-c:a",
            "libopus",
            "-application",
            "voip",
            "-b:a",
            "32k",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-avoid_negative_ts",
            "make_zero",
            "-f",
            "ogg",
            outPath,
        ]);
        const outBuffer = await fs.readFile(outPath);
        if (outBuffer.length > 0) {
            const meta = await extractWaveformAndDuration(ffmpegPath, outPath);
            return {
                buffer: outBuffer,
                mimetype: "audio/ogg; codecs=opus",
                converted: true,
                ...meta,
            };
        }
    } catch (err) {
        console.error("[AudioConvert] Failed to convert audio to OGG/Opus:", err);
    } finally {
        await fs.unlink(inPath).catch(() => {});
        await fs.unlink(outPath).catch(() => {});
    }

    return {
        buffer: inputBuffer,
        mimetype: inputMimetype || "audio/ogg; codecs=opus",
        converted: false,
    };
}
