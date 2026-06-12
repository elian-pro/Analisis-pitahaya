import { google } from 'googleapis';
import { getChatAuth } from './auth';

export interface ChatSpace {
  id:   string;   // "spaces/AAAA..."
  name: string;   // display name
}

export async function listSpaces(): Promise<ChatSpace[]> {
  const auth = getChatAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chat = google.chat({ version: 'v1', auth }) as any;
  const spaces: ChatSpace[] = [];
  let pageToken: string | undefined;

  do {
    const res = await chat.spaces.list({
      pageSize: 100,
      ...(pageToken ? { pageToken } : {}),
    });

    for (const s of (res.data?.spaces ?? [])) {
      if (s.name && (s.displayName || s.spaceType)) {
        spaces.push({
          id:   s.name as string,
          name: (s.displayName || s.name) as string,
        });
      }
    }
    pageToken = res.data?.nextPageToken ?? undefined;
  } while (pageToken);

  return spaces;
}

export async function sendChatMessage(spaceId: string, text: string): Promise<void> {
  const auth = getChatAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chat = google.chat({ version: 'v1', auth }) as any;
  await chat.spaces.messages.create({
    parent: spaceId,
    requestBody: { text },
  });
}
