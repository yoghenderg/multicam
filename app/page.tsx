"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SlotSettings = {
  deviceId: string;
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
};

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
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
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettings] = useState<SlotSettings>({
    deviceId: "",
    rotation: 0,
    mirrored: false,
  });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState("Allow camera access to detect the webcam.");
  const [photoUrl, setPhotoUrl] = useState("");

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
      ...current,
      deviceId:
        current.deviceId && videoDevices.some((device) => device.deviceId === current.deviceId)
          ? current.deviceId
          : videoDevices[0]?.deviceId || "",
    }));

    if (videoDevices.length >= 1) {
      setStatus("Webcam detected. Choose a device, then capture a photo.");
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
    const deviceId = settings.deviceId;
    const videoElement = videoARef.current;
    if (!deviceId || !videoElement) return;

    async function openStream() {
      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: deviceId },
            width: { ideal: 1080 },
            height: { ideal: 1920 },
          },
        });

        if (cancelled) {
          stopStream(nextStream);
          return;
        }

        setStream((current) => {
          if (current && current !== nextStream) stopStream(current);
          return nextStream;
        });
        videoElement.srcObject = nextStream;
        await videoElement.play();
      } catch {
        setStatus("Could not open the selected camera. Choose another device or refresh.");
      }
    }

    openStream();

    return () => {
      cancelled = true;
    };
  }, [settings.deviceId]);

  useEffect(
    () => () => {
      stopStream(stream);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [stream, photoUrl],
  );

  function updateSettings(nextSettings: Partial<SlotSettings>) {
    setSettings((current) => ({ ...current, ...nextSettings }));
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

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-[#1b1d1f]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6">
        <header className="grid gap-4 border-b border-[#242424]/15 pb-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#526056]">
              Dual webcam portrait tester
            </p>
            <h1 className="mt-1 text-3xl font-semibold sm:text-5xl">Camera A</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="secondary-button" onClick={requestAccess}>
              Refresh cameras
            </button>
          </div>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 py-4">
          <p className="max-w-2xl text-sm font-medium text-[#4a4f4d]">{status}</p>
          <p className="rounded-full bg-[#dce7df] px-3 py-1 text-xs font-semibold text-[#22372d]">
            {devices.length} webcam{devices.length === 1 ? "" : "s"} detected
          </p>
        </div>

        <CameraPanel
          actionLabel={photoUrl ? "Retake photo" : "Capture photo"}
          deviceOptions={deviceOptions}
          kind="photo"
          onAction={capturePhoto}
          onChange={updateSettings}
          settings={settings}
          videoRef={videoARef}
        />
      </section>
    </main>
  );
}

function CameraPanel({
  actionLabel,
  deviceOptions,
  kind,
  onAction,
  onChange,
  settings,
  videoRef,
}: {
  actionLabel: string;
  deviceOptions: { id: string; label: string }[];
  kind: "photo" | "video";
  onAction: () => void;
  onChange: (settings: Partial<SlotSettings>) => void;
  settings: SlotSettings;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const title = "Camera A";

  return (
    <section className="camera-section">
      <div className="section-top">
        <div>
          <h2>{title}</h2>
          <p>{kind === "photo" ? "Portrait photo capture" : "Portrait video preview"}</p>
        </div>
        <button className="capture-button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>

      <div className="viewfinder-frame" aria-label={`${title} 6 by 19 portrait viewfinder`}>
        <video
          autoPlay
          muted
          playsInline
          ref={videoRef}
          style={{ transform: transformStyle(settings) }}
        />
        <div className="viewfinder-overlay">
          <span>{title}</span>
          <span>6:19</span>
        </div>
      </div>

      <div className="controls-grid">
        <label>
          <span>Device</span>
          <select
            value={settings.deviceId}
            onChange={(event) => onChange({ deviceId: event.target.value })}
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
                onClick={() => onChange({ rotation })}
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
              onClick={() => onChange({ mirrored: true })}
              type="button"
            >
              Mirror
            </button>
            <button
              aria-pressed={!settings.mirrored}
              onClick={() => onChange({ mirrored: false })}
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
