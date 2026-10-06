import fs from "fs";
import memoryManager from "../../../utils/memory.js";
import { readFileEfficiently } from "../../../utils/file.js";
import { cstSearchFirst, cstAudioData, downloadToFile } from "../../../utils/cstYt.js";

const getRandom = (ext) => memoryManager.generateTempFileName(ext);
const MAX_AUDIO_SECONDS = 30 * 60; // 30 min
const MAX_BYTES = 55 * 1024 * 1024;

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { evv, command, sendMessageWTyping } = msgInfoObj;

	if (!args[0]) return sendMessageWTyping(from, { text: `❌ *Enter song name*` }, { quoted: msg });

	await sendMessageWTyping(from, { text: `🔍 Searching for: *${evv}*...` }, { quoted: msg });
	console.log("Song request:", evv);

	const fileDown = getRandom(".m4a");

	try {
		const found = await cstSearchFirst(evv);
		console.log("Found:", found.id, found.title);
		if (found.duration > MAX_AUDIO_SECONDS) {
			return sendMessageWTyping(
				from,
				{ text: `❌ Result is too long (${Math.round(found.duration / 60)} min, max 30 min). Try a more specific name.` },
				{ quoted: msg }
			);
		}

		await sendMessageWTyping(from, { text: `⏳ Downloading audio...` }, { quoted: msg });

		const audio = await cstAudioData(found.id);
		if (audio.duration > MAX_AUDIO_SECONDS) {
			return sendMessageWTyping(
				from,
				{ text: `❌ Result is too long (${Math.round(audio.duration / 60)} min, max 30 min). Try a more specific name.` },
				{ quoted: msg }
			);
		}

		const { bytes } = await downloadToFile(audio.url, fileDown, MAX_BYTES);
		if (!fs.existsSync(fileDown) || fs.statSync(fileDown).size === 0) throw new Error("Audio file was not created");

		const title = audio.title !== "Unknown" ? audio.title : found.title;
		const fileSizeMB = bytes / 1024 / 1024;
		console.log(`Audio ready: ${fileSizeMB.toFixed(2)}MB - ${title}`);

		const audioBuffer = await readFileEfficiently(fileDown);
		let sock_data;
		if (command === "song") {
			sock_data = {
				document: audioBuffer,
				mimetype: "audio/mp4",
				fileName: `${title}.m4a`,
				caption: `🎵 *${title}*\n📊 Size: ${fileSizeMB.toFixed(2)}MB`,
			};
		} else {
			sock_data = {
				audio: audioBuffer,
				mimetype: "audio/mp4",
				fileName: `${title}.m4a`,
			};
		}

		await sendMessageWTyping(from, sock_data, { quoted: msg });
		console.log("Audio sent successfully");
	} catch (err) {
		console.error("Song download error:", err);
		const m = (err.message || "").toLowerCase();
		let errorMsg = "❌ Download failed. ";
		if (m.includes("no results")) errorMsg += `No songs found for: *${evv}*`;
		else if (m.includes("too large")) errorMsg += err.message;
		else if (m.includes("timeout") || m.includes("abort")) errorMsg += "Server timed out. Please try again.";
		else errorMsg += "Please try again with a different song.";
		await sendMessageWTyping(from, { text: errorMsg }, { quoted: msg });
	} finally {
		memoryManager.safeUnlink(fileDown);
	}
};

export default () => ({
	cmd: ["song", "play"],
	desc: "Download a song by name.",
	usage: "song | play | song [song name]",
	handler,
});
