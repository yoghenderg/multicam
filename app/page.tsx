"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Slot = "a" | "b";

type SlotSettings = {
  deviceId: string;
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
};

const OUTPUT_WIDTH = 360;
const OUTPUT_HEIGHT = 1140;
const ROTATIONS: SlotSettings["rotation"][] = [0, 90, 180, 270];

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function transformStyle(settings: SlotSettings) {
  const mirrorScale = settings.mirrored ? "scaleX(-1)" : "scaleX(1)";
  return `translate(-50%, -50%) rotate(${settings.rotation}deg) ${mirrorScale}`;
}

function drawFittedVideo(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  settings: SlotSettings,
) {
  const canvas = context.canvas;
  const videoWidth = video.videoWidth || OUTPUT_WIDTH;
  const videoHeight = video.videoHeight || OUTPUT_HEIGHT;
  const rotated = settings.rotation === 90 || settings.rotation === 270;
  const sourceWidth = rotated ? videoHeight : videoWidth;
  const sourceHeight = rotated ? videoWidth : videoHeight;
  const scale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);

  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);

  if (settings.mirrored) {
    context.scale(-1, 1);
  }

  context.rotate((settings.rotation * Math.PI) / 180);
  context.drawImage(
    video,
    (-videoWidth * scale) / 2,
    (-videoHeight * scale) / 2,
    videoWidth * scale,
    videoHeight * scale,
  );
  context.restore();
}

function createOutputCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

export default function Home() {
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettings] = useState<Record<Slot, SlotSettings>>({
    a: { deviceId: "", rotation: 0, mirrored: false },
    b: { deviceId: "", rotation: 0, mirrored: false },
  });
  const [streams, setStreams] = useState<Record<Slot, MediaStream | null>>({
    a: null,
    b: null,
  });
  const [status, setStatus] = useState("Allow camera access to detect both webcams.");
  const [photoUrl, setPhotoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [view, setView] = useState<"capture" | "result">("capture");

  const deviceOptions = useMemo(
    () =>
      devices.map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Camera ${index + 1}`,
      })),
    [devices],
  );

  const refreshDevices = useCallback(async () => {
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = allDevices.filter((device) => device.kind === "videoinput");
    setDevices(videoDevices);
    setSettings((current) => ({
      a: {
        ...current.a,
        deviceId: current.a.deviceId || videoDevices[0]?.deviceId || "",
      },
      b: {
        ...current.b,
        deviceId:
          current.b.deviceId ||
          videoDevices[1]?.deviceId ||
          videoDevices[0]?.deviceId ||
          "",
      },
    }));

    if (videoDevices.length >= 2) {
      setStatus("Two webcams detected. Capture A as a photo and B as a 5-second video.");
    } else if (videoDevices.length === 1) {
      setStatus("One webcam detected. Connect another webcam, then refresh cameras.");
    } else {
      setStatus("No webcam detected yet. Check browser permissions and camera connection.");
    }
  }, []);

  const requestAccess = useCallback(async () => {
    try {
      setStatus("Requesting webcam access...");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stopStream(stream);
      await refreshDevices();
    } catch {
      setStatus("Camera access was blocked or unavailable. Allow access in the browser and try again.");
    }
  }, [refreshDevices]);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("This browser does not support camera capture.");
      return;
    }

    requestAccess();
    navigator.mediaDevices.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices, requestAccess]);

  useEffect(() => {
    let cancelled = false;

    async function openStream(slot: Slot) {
      const deviceId = settings[slot].deviceId;
      const videoElement = slot === "a" ? videoARef.current : videoBRef.current;
      if (!deviceId || !videoElement) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1080 },
            height: { ideal: 1920 },
          },
        });

        if (cancelled) {
          stopStream(stream);
          return;
        }

        setStreams((current) => {
          stopStream(current[slot]);
          return { ...current, [slot]: stream };
        });
        videoElement.srcObject = stream;
        await videoElement.play();
      } catch {
        setStatus(`Could not open Camera ${slot.toUpperCase()}. Choose another device or refresh.`);
      }
    }

    openStream("a");
    openStream("b");

    return () => {
      cancelled = true;
    };
  }, [settings.a.deviceId, settings.b.deviceId]);

  useEffect(
    () => () => {
      stopStream(streams.a);
      stopStream(streams.b);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    },
    [streams.a, streams.b, photoUrl, videoUrl],
  );

  useEffect(() => {
    if (photoUrl && videoUrl) {
      setView("result");
    }
  }, [photoUrl, videoUrl]);

  function updateSlot(slot: Slot, nextSettings: Partial<SlotSettings>) {
    setSettings((current) => ({
      ...current,
      [slot]: { ...current[slot], ...nextSettings },
    }));
  }

  function exchangeCameras() {
    setSettings((current) => ({
      a: { ...current.a, deviceId: current.b.deviceId },
      b: { ...current.b, deviceId: current.a.deviceId },
    }));
  }

  function capturePhoto() {
    const video = videoARef.current;
    if (!video || !video.videoWidth) {
      setStatus("Camera A is not ready yet.");
      return;
    }

    const canvas = createOutputCanvas();
    const context = canvas.getContext("2d");
    if (!context) return;

    drawFittedVideo(context, video, settings.a);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        setPhotoUrl(URL.createObjectURL(blob));
        setStatus("Photo captured. Record Camera B when you are ready.");
      },
      "image/jpeg",
      0.95,
    );
  }

  function recordVideo() {
    const video = videoBRef.current;
    if (!video || !video.videoWidth || isRecording) {
      setStatus("Camera B is not ready yet.");
      return;
    }

    const canvas = createOutputCanvas();
    const context = canvas.getContext("2d");
    if (!context) return;

    const canvasStream = canvas.captureStream(30);
    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(canvasStream, { mimeType });
    let animationFrame = 0;
    let timer = 0;

    const draw = () => {
      drawFittedVideo(context, video, settings.b);
      animationFrame = requestAnimationFrame(draw);
    };

    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };

    recorder.onstop = () => {
      cancelAnimationFrame(animationFrame);
      window.clearInterval(timer);
      canvasStream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: mimeType });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
      setIsRecording(false);
      setRecordingProgress(5);
      setStatus("Video recorded. Review your photo and video.");
    };

    setIsRecording(true);
    setRecordingProgress(0);
    setStatus("Recording Camera B for 5 seconds...");
    draw();
    recorder.start();

    const startedAt = Date.now();
    timer = window.setInterval(() => {
      const elapsed = Math.min(5, (Date.now() - startedAt) / 1000);
      setRecordingProgress(elapsed);
    }, 100);

    window.setTimeout(() => recorder.stop(), 5000);
  }

  function resetCapture() {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setPhotoUrl("");
    setVideoUrl("");
    setRecordingProgress(0);
    setView("capture");
    setStatus("Ready for another webcam test.");
  }

  if (view === "result") {
    return (
      <main className="min-h-screen bg-[#f4f1ea] text-[#1b1d1f]">
        <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#242424]/15 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#526056]">
                Review
              </p>
              <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">Capture result</h1>
            </div>
            <button className="primary-button" onClick={resetCapture}>
              New test
            </button>
          </div>

          <div className="grid flex-1 gap-5 py-6 lg:grid-cols-2">
            <ResultPanel title="Camera A photo">
              {photoUrl ? <img alt="Captured from Camera A" src={photoUrl} /> : null}
            </ResultPanel>
            <ResultPanel title="Camera B video">
              {videoUrl ? (
                <video controls playsInline src={videoUrl} />
              ) : null}
            </ResultPanel>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-[#1b1d1f]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6">
        <header className="grid gap-4 border-b border-[#242424]/15 pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#526056]">
              Dual webcam portrait tester
            </p>
            <h1 className="mt-1 text-3xl font-semibold sm:text-5xl">Camera A / Camera B</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={requestAccess}>
              Refresh cameras
            </button>
            <button
              className="primary-button"
              disabled={!settings.a.deviceId || !settings.b.deviceId}
              onClick={exchangeCameras}
            >
              Exchange A and B
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="max-w-2xl text-sm font-medium text-[#4a4f4d]">{status}</p>
          <p className="rounded-full bg-[#dce7df] px-3 py-1 text-xs font-semibold text-[#22372d]">
            {devices.length} webcam{devices.length === 1 ? "" : "s"} detected
          </p>
        </div>

        <div className="grid flex-1 gap-5 lg:grid-cols-2">
          <CameraPanel
            actionLabel={photoUrl ? "Retake photo" : "Capture photo"}
            deviceOptions={deviceOptions}
            kind="photo"
            onAction={capturePhoto}
            onChange={updateSlot}
            settings={settings.a}
            slot="a"
            videoRef={videoARef}
          />
          <CameraPanel
            actionLabel={isRecording ? `Recording ${Math.ceil(5 - recordingProgress)}s` : videoUrl ? "Record again" : "Record 5s video"}
            deviceOptions={deviceOptions}
            disabled={isRecording}
            kind="video"
            onAction={recordVideo}
            onChange={updateSlot}
            progress={recordingProgress / 5}
            settings={settings.b}
            slot="b"
            videoRef={videoBRef}
          />
        </div>
      </section>
    </main>
  );
}

function CameraPanel({
  actionLabel,
  deviceOptions,
  disabled = false,
  kind,
  onAction,
  onChange,
  progress = 0,
  settings,
  slot,
  videoRef,
}: {
  actionLabel: string;
  deviceOptions: { id: string; label: string }[];
  disabled?: boolean;
  kind: "photo" | "video";
  onAction: () => void;
  onChange: (slot: Slot, settings: Partial<SlotSettings>) => void;
  progress?: number;
  settings: SlotSettings;
  slot: Slot;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const title = `Camera ${slot.toUpperCase()}`;

  return (
    <section className="camera-section">
      <div className="section-top">
        <div>
          <h2>{title}</h2>
          <p>{kind === "photo" ? "Portrait photo capture" : "5-second portrait video"}</p>
        </div>
        <button className="capture-button" disabled={disabled} onClick={onAction}>
          {actionLabel}
        </button>
      </div>

      <div className="viewfinder-frame" aria-label={`${title} 6 by 19 portrait viewfinder`}>
        <video
          autoPlay
          className={settings.rotation === 90 || settings.rotation === 270 ? "rotated" : ""}
          muted
          playsInline
          ref={videoRef}
          style={{ transform: transformStyle(settings) }}
        />
        <div className="viewfinder-overlay">
          <span>{title}</span>
          <span>6:19</span>
        </div>
        {kind === "video" && progress > 0 ? (
          <div className="record-progress" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        ) : null}
      </div>

      <div className="controls-grid">
        <label>
          <span>Device</span>
          <select
            value={settings.deviceId}
            onChange={(event) => onChange(slot, { deviceId: event.target.value })}
          >
            {deviceOptions.length ? (
              deviceOptions.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.label}
                </option>
              ))
            ) : (
              <option value="">No camera found</option>
            )}
          </select>
        </label>

        <div className="control-group">
          <span>Rotation</span>
          <div className="segmented">
            {ROTATIONS.map((rotation) => (
              <button
                aria-pressed={settings.rotation === rotation}
                key={rotation}
                onClick={() => onChange(slot, { rotation })}
                type="button"
              >
                {rotation}°
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span>Mirror</span>
          <div className="segmented two">
            <button
              aria-pressed={settings.mirrored}
              onClick={() => onChange(slot, { mirrored: true })}
              type="button"
            >
              Mirror
            </button>
            <button
              aria-pressed={!settings.mirrored}
              onClick={() => onChange(slot, { mirrored: false })}
              type="button"
            >
              No mirror
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ResultPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="result-section">
      <h2>{title}</h2>
      <div className="result-frame">{children}</div>
    </section>
  );
}
