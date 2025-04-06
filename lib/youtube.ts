import { google } from 'googleapis';

if (!process.env.YOUTUBE_API_KEY) {
  throw new Error('Missing YOUTUBE_API_KEY environment variable');
}

// YouTube API の型定義
interface Author {
  displayName: string;
  profileImageUrl: string;
  channelId: string;
}

interface MessageSnippet {
  displayMessage: string;
  publishedAt: string;
}

interface ChatItem {
  id: string;
  snippet: MessageSnippet;
  authorDetails: Author;
}

interface ChatResponse {
  items: ChatItem[];
  nextPageToken: string;
  pollingIntervalMillis: number;
}

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

export async function sendChatMessage(liveChatId: string, message: string) {
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

export async function getLiveChatId(videoId: string): Promise<string | null> {
  try {
    const response = await youtube.videos.list({
      part: ['liveStreamingDetails'],
      id: [videoId],
    });
    return response.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId || null;
  } catch (error) {
    console.error('Error getting live chat ID:', error);
    throw error;
  }
}

export async function getLiveChatMessages(liveChatId: string, pageToken: string | null): Promise<ChatResponse> {
  try {
    const response = await youtube.liveChatMessages.list({
      part: ['snippet', 'authorDetails'],
      liveChatId,
      pageToken: pageToken || undefined,
    });
    return response.data as ChatResponse;
  } catch (error) {
    console.error('Error getting live chat messages:', error);
    throw error;
  }
}