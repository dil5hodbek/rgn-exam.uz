"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  src, className, onPlay, onEnded, autoStartDelay,
}: {
  src: string;
  className?: string;
  onPlay?: (audio: HTMLAudioElement) => void;
  onEnded?: () => void;
  /** Start playing this many ms after the player appears — unless the student
   *  has already pressed play or pause themselves. */
  autoStartDelay?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  // Any manual play/pause cancels the pending auto-start and keeps the
  // student in control (a paused recording stays paused).
  const interacted = useRef(false);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    interacted.current = false;
    if (!autoStartDelay) return;
    const timer = window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio || interacted.current || !audio.paused) return;
      audio.play().catch(() => { /* browser blocked autoplay — student presses play */ });
    }, autoStartDelay);
    return () => window.clearTimeout(timer);
  }, [src, autoStartDelay]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    interacted.current = true;
    if (audio.paused) audio.play(); else audio.pause();
  }

  function seek(event: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(event.target.value);
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function changeVolume(event: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const value = Number(event.target.value);
    audio.volume = value;
    audio.muted = value === 0;
    setVolume(value);
    setMuted(value === 0);
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.muted || audio.volume === 0) {
      audio.muted = false;
      if (audio.volume === 0) { audio.volume = 1; setVolume(1); }
      setMuted(false);
    } else {
      audio.muted = true;
      setMuted(true);
    }
  }

  const progress = duration ? (currentTime / duration) * 100 : 0;
  const volumePercent = (muted ? 0 : volume) * 100;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume <= 0.55 ? Volume1 : Volume2;

  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-1.5 shadow-sm", className)}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={(event) => { setPlaying(true); onPlay?.(event.currentTarget); }}
        onPause={() => { setPlaying(false); interacted.current = true; }}
        onEnded={() => { setPlaying(false); onEnded?.(); }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
      {/* Play / pause — always the leftmost control */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-white transition-all active:scale-90",
          playing
            ? "bg-brand shadow-lg shadow-indigo-500/40 ring-4 ring-indigo-500/15"
            : "bg-brand shadow-md shadow-indigo-500/30 hover:scale-105 hover:shadow-lg hover:shadow-indigo-500/40",
        )}
      >
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current pl-0.5" />}
      </button>

      <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-ink">
        {formatTime(currentTime)}<span className="text-muted"> / {formatTime(duration)}</span>
      </span>

      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={seek}
        className="player-seek h-1.5 min-w-[48px] flex-1"
        style={{ background: `linear-gradient(to right, var(--accent) ${progress}%, var(--border) ${progress}%)` }}
        aria-label="Seek"
      />

      {/* Volume: icon toggles mute, slider sets the level */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? "Unmute" : "Mute"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-canvas hover:text-brand"
        >
          <VolumeIcon className="h-4 w-4" />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={changeVolume}
          className="player-seek hidden h-1 w-14 sm:block"
          style={{ background: `linear-gradient(to right, var(--accent) ${volumePercent}%, var(--border) ${volumePercent}%)` }}
          aria-label="Volume"
        />
      </div>
    </div>
  );
}
