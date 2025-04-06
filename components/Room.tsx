"use client";

import { Users } from "lucide-react";
import Seat from "./Seat";

interface Seat {
  id: string;
  username: string | null;
  task?: string | null;
  enterTime?: Date | string | null;
  autoExitScheduled?: Date | string | null;
  timestamp: Date | string | number;
}

interface RoomProps {
  room: {
    id: string;
    seats: Seat[];
    type?: 'focus' | 'chat';
  };
}

export default function Room({ room }: RoomProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Users className="h-5 w-5" />
        <h2 className="text-xl font-semibold">Room {room.id}</h2>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        {room.seats.map((seat) => (
          <Seat key={seat.id} seat={seat} />
        ))}
      </div>
    </div>
  );
}