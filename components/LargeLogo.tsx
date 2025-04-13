"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";

export default function LargeLogo() {
  const [opacity, setOpacity] = useState(0.4);
  const [transform, setTransform] = useState("translateZ(0) rotateY(0deg)");
  const [glowColor, setGlowColor] = useState("rgba(255, 255, 255, 0.15)");
  const logoRef = useRef<HTMLDivElement>(null);

  // マウス移動に対するインタラクション
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!logoRef.current) return;
      
      // ビューポートの中心からの距離を計算
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;
      const mouseX = e.clientX;
      const mouseY = e.clientY;
      
      // マウス位置に基づいて回転角度を計算（-5度〜+5度の範囲）
      const rotateY = ((mouseX - centerX) / centerX) * 5;
      const rotateX = ((mouseY - centerY) / centerY) * -3;
      
      // 3D効果を適用
      setTransform(`
        perspective(1500px) 
        rotateY(${rotateY}deg) 
        rotateX(${rotateX}deg) 
        translateZ(20px)
      `);

      // マウス位置に応じてオーバーレイの色を変更
      const hue = Math.floor((mouseX / window.innerWidth) * 60) + 200; // 青～紫系
      setGlowColor(`hsla(${hue}, 100%, 50%, 0.15)`);
    };

    // スクロールイベントのリスナー
    const handleScroll = () => {
      const scrollY = window.scrollY;
      // スクロール位置によってロゴの不透明度を調整（0.2～0.5の範囲）
      const newOpacity = Math.min(0.5, Math.max(0.2, 0.5 - scrollY / 800));
      setOpacity(newOpacity);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center pointer-events-none z-0"
      style={{
        overflow: "hidden",
      }}
    >
      {/* グローエフェクト（背後に柔らかい発光） */}
      <div 
        className="absolute w-[85vw] h-[70vh] rounded-full blur-[100px] transition-all duration-1000"
        style={{
          background: glowColor,
          opacity: opacity * 1.2,
        }}
      />
      
      {/* ロゴ本体 */}
      <div 
        ref={logoRef}
        className="relative w-[90vw] h-[70vh] transition-all duration-500"
        style={{ 
          opacity: opacity,
          transform: transform,
          filter: "drop-shadow(0 0 15px rgba(255, 255, 255, 0.3))",
        }}
      >
        <Image 
          src="/connect_logo.png" 
          alt="" 
          fill
          style={{ 
            objectFit: 'contain',
          }}
          priority
          className="logo-image"
        />

      </div>
      
      {/* アニメーションスタイル */}
      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-15px); }
        }
        
        .logo-image {
          animation: float 8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
} 