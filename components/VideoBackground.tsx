import React from "react";
import Image from "next/image";

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
      
      {/* 動画オーバーレイをグラデーションにして深みを出す */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/40 to-black/30"></div>
      
      {/* スタイリッシュな背景パターン */}
      <div 
        className="absolute inset-0 opacity-10" 
        style={{ 
          backgroundImage: `radial-gradient(circle at 25px 25px, rgba(255, 255, 255, 0.2) 2%, transparent 0%), 
                           radial-gradient(circle at 75px 75px, rgba(255, 255, 255, 0.2) 2%, transparent 0%)`,
          backgroundSize: '100px 100px'
        }}
      ></div>
    </div>
  );
} 