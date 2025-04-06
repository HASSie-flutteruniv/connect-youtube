"use client";

import { User } from "lucide-react";
import { calculateElapsedTime, getElapsedTimeStyle } from "@/lib/utils";

interface SeatProps {
  seat: {
    id: string;
    username: string | null;
    task?: string | null;
    enterTime?: Date | string | null;
    autoExitScheduled?: Date | string | null;
    timestamp: Date | string | number;
  };
}

export default function Seat({ seat }: SeatProps) {
  const isOccupied = Boolean(seat.username);
  const elapsedTime = seat.enterTime ? calculateElapsedTime(seat.enterTime) : "";
  const timeStyle = seat.enterTime ? getElapsedTimeStyle(seat.enterTime) : "";
  
  return (
    <div
      className={`
        p-4 rounded-lg
        ${isOccupied ? 'bg-primary/10' : 'bg-muted'}
      `}
    >
      <div className="flex items-center gap-3 mb-1">
        <User className={`h-5 w-5 ${isOccupied ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className={isOccupied ? 'text-primary font-medium' : 'text-muted-foreground'}>
          {seat.username || 'Empty'}
        </span>
      </div>
      
      {isOccupied && (
        <div className="mt-1 pl-8">
          {seat.task && <p className="text-sm text-muted-foreground truncate">{seat.task}</p>}
          {elapsedTime && <p className={`text-sm font-medium ${timeStyle}`}>経過: {elapsedTime}</p>}
        </div>
      )}
    </div>
  );
}