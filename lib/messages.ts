export interface MessageTemplate {
  seatTaken: (username: string, roomId: string, position: number, taskName?: string) => string;
  seatVacated: (username: string, roomId: string, position: number) => string;
  taskUpdated: (username: string, taskName: string) => string;
  welcome: (username: string) => string;
  error: (message: string) => string;
  noSeatAvailable: (username: string) => string;
  autoExited: (username: string, roomId: string, position: number) => string;
}

export const messageTemplates: MessageTemplate = {
  seatTaken: (username: string, roomId: string, position: number, taskName?: string) =>
    `🪑 ${username}さんが「${taskName || '作業中'}」のため、部屋${roomId}の座席${position}に着席しました！`,
  
  seatVacated: (username: string, roomId: string, position: number) =>
    `👋 ${username}さんが部屋${roomId}の座席${position}から退席しました。`,
  
  taskUpdated: (username: string, taskName: string) =>
    `📝 ${username}さんが作業内容を「${taskName}」に更新しました。`,
  
  welcome: (username: string) =>
    `👋 ようこそ、${username}さん！`,
  
  error: (message: string) =>
    `❌ エラーが発生しました: ${message}`,
    
  noSeatAvailable: (username: string) =>
    `😓 申し訳ありませんが、${username}さん向けの空席がありません。後ほど再度お試しください。`,
    
  autoExited: (username: string, roomId: string, position: number) =>
    `⏱ ${username}さんが2時間経過したため、部屋${roomId}の座席${position}から自動退席しました。`,
};