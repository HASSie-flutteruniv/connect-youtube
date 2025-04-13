import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Volume2, VolumeX } from 'lucide-react';

interface BGMPlayerProps {
  title?: string;
}

export default function BGMPlayer({ title = 'Lofi Jazz - Relaxing Jazz Music' }: BGMPlayerProps) {
  const [isMuted, setIsMuted] = useState(false);
  
  return (
    <Card className="bg-[#f2f2f2]/70 backdrop-blur-sm shadow-md border border-white/20">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-amber-500 text-xl">♪</span>
          <h2 className="font-medium">現在のBGM</h2>
        </div>
        
        <div className="flex items-center gap-4">
          <span className="text-gray-600 text-sm">{title}</span>
          <button 
            className="p-1.5 border border-gray-300/70 rounded-full hover:bg-gray-100/80 transition-colors"
            onClick={() => setIsMuted(!isMuted)}
          >
            {isMuted ? <VolumeX className="h-4 w-4 text-gray-500" /> : <Volume2 className="h-4 w-4 text-gray-500" />}
          </button>
        </div>
      </div>
    </Card>
  );
} 