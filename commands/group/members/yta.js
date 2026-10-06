import fs from "fs";
import memoryManager from "../../../utils/memory.js";
import { readFileEfficiently } from "../../../utils/file.js";
import { parseYouTubeUrl } from "../../../utils/ytdlp.js";
import { cstAudioData, downloadToFile } from "../../../utils/cstYt.js";

const getRandom = (ext) => memoryManager.generateTempFileName(ext);
const MAX_AUDIO_SECONDS = 30 * 60;
const MAX_BYTES = 55 * 1024 * 1024;
const ytId = (u) => (u.match(/[?&]v=([A-Za-z0-9_-]{11})/) || u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) || [])[1];

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	const url = args[0] && parseYouTubeUrl(args[0]);
	const id = url && ytId(url);
	if (!id) {
		return sendMessageWTyping(from, { text: `❌ *Enter Youtube link*` }, { quoted: msg });
	}

	const fileDown = getRandom(".m4a");

	try {
		await sendMessageWTyping(from, { text: `⏳ Downloading audio...` }, { quoted: msg });
		const audio = await cstAudioData(id);
		if (audio.duration > MAX_AUDIO_SECONDS) {
			return sendMessageWTyping(
				from,
				{ text: `❌ Video is too long (${Math.round(audio.duration / 60)} minutes). Maximum 30 minutes allowed.` },
				{ quoted: msg }
			);
		}

		const { bytes } = await downloadToFile(audio.url, fileDown, MAX_BYTES);
		if (!fs.existsSync(fileDown) || fs.statSync(fileDown).size === 0) throw new Error("Audio file was not created");
		console.log("Audio downloaded");

		const audioBuffer = await readFileEfficiently(fileDown);
		await sendMessageWTyping(
			from,
			{ audio: audioBuffer, mimetype: "audio/mp4", fileName: `${audio.title}.m4a` },
			{ quoted: msg }
		);
		console.log("Sent");
	} catch (err) {
		console.error("yta error:", err);
		const m = (err.message || "").toLowerCase();
		let errorMsg = "❌ Download failed. ";
		if (m.includes("too large")) errorMsg += err.message;
		else if (m.includes("timeout") || m.includes("abort")) errorMsg += "Server timed out. Please try again.";
		else errorMsg += "Please try a different link.";
		sendMessageWTyping(from, { text: errorMsg }, { quoted: msg });
	} finally {
		memoryManager.safeUnlink(fileDown);
	}
};

export default () => ({
	cmd: ["yta"],
	desc: "Download the audio of a YouTube video.",
	usage: "yta <youtube link>",
	handler,
});
