// YouTube API用のヘルパー関数（JavaScript版）

const { google } = require('googleapis');

if (!process.env.YOUTUBE_API_KEY) {
  throw new Error('Missing YOUTUBE_API_KEY environment variable');
}

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

async function sendChatMessage(liveChatId, message) {
  try {
    const response = await youtube.liveChatMessages.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: {
            messageText: message,
          },
        },
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error sending chat message:', error);
    throw error;
  }
}

async function getLiveChatId(videoId) {
  try {
    const response = await youtube.videos.list({
      part: ['liveStreamingDetails'],
      id: [videoId],
    });
    return response.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  } catch (error) {
    console.error('Error getting live chat ID:', error);
    throw error;
  }
}

async function getLiveChatMessages(liveChatId, pageToken) {
  try {
    const response = await youtube.liveChatMessages.list({
      part: ['snippet', 'authorDetails'],
      liveChatId,
      pageToken,
    });
    return response.data;
  } catch (error) {
    console.error('Error getting live chat messages:', error);
    throw error;
  }
}

module.exports = {
  sendChatMessage,
  getLiveChatId,
  getLiveChatMessages
}; 