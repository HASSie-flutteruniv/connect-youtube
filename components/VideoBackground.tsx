import React from "react";

interface VideoBackgroundProps {
  videoUrl: string;
}

export default function VideoBackground({ videoUrl }: VideoBackgroundProps) {
  return (
    <div className="fixed inset-0 w-full h-full overflow-hidden z-0">
      <video
        className="absolute min-w-full min-h-full object-cover w-full h-full"
        autoPlay
        muted
        loop
        playsInline
      >
        <source src={videoUrl} type="video/mp4" />
        お使いのブラウザは動画タグをサポートしていません。
      </video>
      {/* オーバーレイで動画の上に薄暗い層を追加し、UIの視認性を確保 */}
      <div className="absolute inset-0 bg-black/40"></div>
    </div>
  );
} 