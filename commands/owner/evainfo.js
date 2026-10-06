import { getGroupData } from "../../db/groupData.js";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping, isGroup } = msgInfoObj;

	if (!isGroup) {
		return sendMessageWTyping(from, { text: "```This command is only for groups!```" }, { quoted: msg });
	}

	try {
		const data = await getGroupData(from);

		if (!data) {
			return sendMessageWTyping(from, { text: "❌ Could not fetch group data." }, { quoted: msg });
		}

		const historyLength = data.chatHistory ? data.chatHistory.length : 0;
		const conversations = Math.floor(historyLength / 2); // Each conversation = user + bot message
		const isChatBotOn = data.isChatBotOn || false;

		const info = `╭━━━『 *EVA INFO* 』━━━╮
│
│ 📊 *Status:* ${isChatBotOn ? "✅ Active" : "❌ Inactive"}
│ 💬 *Conversations in Memory:* ${conversations}
│ 📝 *Total Messages:* ${historyLength}
│ 🧠 *Memory Limit:* 10 conversations
│
╰━━━━━━━━━━━━━━━━━╯

${
	isChatBotOn
		? "Blaze is actively chatting in this group!"
		: "Blaze is currently inactive. Admins can turn it on using the appropriate command."
}

💡 *Tip:* Use *clearhistory* to reset Blaze's memory for this group.`;

		return sendMessageWTyping(from, { text: info }, { quoted: msg });
	} catch (err) {
		console.error(err);
		return sendMessageWTyping(from, { text: "❌ Failed to fetch Blaze info. Please try again." }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["evainfo", "evastat", "evastatus"],
	desc: "Show details of Blaze's chat memory for this group.",
	usage: "evainfo",
	handler,
});
