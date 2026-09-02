"use client";

import * as React from "react";

interface AudioVisualizerImprovedProps {
  mediaStream: MediaStream | null;
  isRecording: boolean;
  forceLight?: boolean; // Add a prop to force light theme
  className?: string; // Custom class for the visualizer container
}

// Color palette with complementary gradient stops for more sophisticated visuals
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  type: "dot" | "circle" | "triangle";
}

function createParticle(isIdle: boolean, x: number, y: number, intensity: number = 1): Particle {
  // Choose a particle type with weighted randomness
  const typeRandom = Math.random();
  let type: "dot" | "circle" | "triangle";
  if (typeRandom < 0.7) {
    type = "dot";
  } else if (typeRandom < 0.9) {
    type = "circle";
  } else {
    type = "triangle";
  }

  // Different colors for idle vs active
  const hue = isIdle ? 260 + Math.random() * 40 : 290 + Math.random() * 50;
  const saturation = 70 + Math.random() * 30;
  const lightness = 50 + Math.random() * 30;
  const color = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.7)`;

  // Adjust velocity and life based on state
  const speed = isIdle ? 0.5 + Math.random() : 2 + Math.random() * 5 * intensity;
  const angle = Math.random() * Math.PI * 2;
  const maxLife = isIdle ? 80 + Math.random() * 40 : 50 + Math.random() * 30;

  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: 1 + Math.random() * 4 * intensity,
    color,
    life: 0,
    maxLife,
    type,
  };
}

export default function AudioVisualizerImproved({
  mediaStream,
  isRecording,
  forceLight = true, // Default to light theme for login page
  className,
}: AudioVisualizerImprovedProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const animationFrameRef = React.useRef<number>(0);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const dataArrayRef = React.useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeRef = React.useRef(0);
  const particlesRef = React.useRef<Particle[]>([]);
  const lastAudioLevelRef = React.useRef(0);
  const lastTimeRef = React.useRef(Date.now());
  const [isDarkMode, setIsDarkMode] = React.useState(false);

  React.useEffect(() => {
    // Detect dark mode after component mounts (client-side only)
    const checkDarkMode = () => {
      const darkModeEnabled = document.documentElement.classList.contains("dark");
      setIsDarkMode(forceLight ? false : darkModeEnabled);
    };

    // Check initially
    checkDarkMode();

    // Setup mutation observer to watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "class" && mutation.target === document.documentElement) {
          checkDarkMode();
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true });

    return () => {
      observer.disconnect();
    };
  }, [forceLight]);

  React.useEffect(() => {
    if (!canvasRef.current) return;

    const audioContext = new AudioContext();
    analyserRef.current = audioContext.createAnalyser();
    analyserRef.current.fftSize = 512; // Increased for more detailed frequency analysis
    const bufferLength = analyserRef.current.frequencyBinCount;
    dataArrayRef.current = new Uint8Array(new ArrayBuffer(bufferLength));

    if (mediaStream && isRecording) {
      const source = audioContext.createMediaStreamSource(mediaStream);
      source.connect(analyserRef.current);
    }

    // Create a pool of idle particles
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 20; i++) {
        const canvas = canvasRef.current;
        if (!canvas) continue;

        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = Math.min(canvas.width, canvas.height) * 0.25;
        const angle = Math.random() * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius * Math.random();
        const y = centerY + Math.sin(angle) * radius * Math.random();

        particlesRef.current.push(createParticle(true, x, y));
      }
    }

    // Handle particles
    const updateParticles = (
      ctx: CanvasRenderingContext2D,
      deltaTime: number,
      centerX: number,
      centerY: number
    ) => {
      const newParticles: Particle[] = [];

      particlesRef.current.forEach((p) => {
        // Update position
        p.x += p.vx * deltaTime;
        p.y += p.vy * deltaTime;

        // Update lifetime
        p.life += deltaTime;

        // Only keep particles that haven't exceeded their lifetime
        if (p.life < p.maxLife) {
          // Calculate alpha based on life
          const progress = p.life / p.maxLife;
          const alpha = progress < 0.2 ? progress / 0.2 : 1 - (progress - 0.2) / 0.8;

          // Draw particle based on type
          ctx.globalAlpha = alpha * 0.8;

          switch (p.type) {
            case "dot":
              ctx.beginPath();
              ctx.fillStyle = p.color;
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
              ctx.fill();
              break;

            case "circle":
              ctx.beginPath();
              ctx.strokeStyle = p.color;
              ctx.lineWidth = p.size / 3;
              ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
              ctx.stroke();
              break;

            case "triangle": {
              ctx.beginPath();
              ctx.fillStyle = p.color;
              const angle = Math.atan2(p.vy, p.vx);
              const size = p.size * 1.5;

              ctx.moveTo(p.x + Math.cos(angle) * size, p.y + Math.sin(angle) * size);
              ctx.lineTo(
                p.x + Math.cos(angle + (2 * Math.PI) / 3) * size,
                p.y + Math.sin(angle + (2 * Math.PI) / 3) * size
              );
              ctx.lineTo(
                p.x + Math.cos(angle + (4 * Math.PI) / 3) * size,
                p.y + Math.sin(angle + (4 * Math.PI) / 3) * size
              );
              ctx.closePath();
              ctx.fill();
              break;
            }
          }

          ctx.globalAlpha = 1;
          newParticles.push(p);
        }
      });

      // Add new idle particles if necessary
      if (newParticles.length < 10) {
        const count = Math.min(3, 10 - newParticles.length);
        for (let i = 0; i < count; i++) {
          const radius =
            Math.min(canvasRef.current?.width || 0, canvasRef.current?.height || 0) * 0.25;
          const angle = Math.random() * Math.PI * 2;
          const x = centerX + Math.cos(angle) * radius * Math.random();
          const y = centerY + Math.sin(angle) * radius * Math.random();

          newParticles.push(createParticle(true, x, y));
        }
      }

      particlesRef.current = newParticles;
    };

    const draw = () => {
      if (!canvasRef.current || !analyserRef.current || !dataArrayRef.current) return;

      const now = Date.now();
      const deltaTime = (now - lastTimeRef.current) / 16.667; // Normalize to 60fps
      lastTimeRef.current = now;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { alpha: false })!;

      // Set canvas dimensions to match container
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      // Get audio data if recording
      let avgAudioLevel = 0;
      let frequencyData: number[] = [];
      let suddenImpact = 0;

      if (mediaStream && isRecording) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        // Create a normalized copy of the frequency data for easier use
        frequencyData = Array.from(dataArrayRef.current).map((v) => v / 255);

        // Calculate average audio level
        const sum = frequencyData.reduce((acc, val) => acc + val, 0);
        avgAudioLevel = sum / frequencyData.length;

        // Detect sudden volume changes for impact effects
        suddenImpact = Math.max(0, avgAudioLevel - lastAudioLevelRef.current);
        lastAudioLevelRef.current = avgAudioLevel * 0.2 + lastAudioLevelRef.current * 0.8; // Smooth transition
      } else {
        // When not recording, create some dummy frequency data for idle animation
        const count = 128;
        frequencyData = Array(count)
          .fill(0)
          .map((_, i) => {
            const angle = (i / count) * Math.PI * 2;
            return 0.1 + Math.sin(angle * 4 + timeRef.current) * 0.05;
          });
      }

      // Update time for animations (scaled by deltaTime)
      timeRef.current += 0.01 * deltaTime;

      // Ensure white background in light mode, dark in dark mode
      ctx.fillStyle = isDarkMode ? "#121826" : "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Create multiple overlapping background gradients - only for dark mode
      const createDynamicBackground = () => {
        // Skip gradients in light mode - keep plain white background
        if (!isDarkMode) return;

        // Main pulsating gradient
        const pulseIntensity =
          0.5 + (isRecording ? avgAudioLevel * 0.5 : Math.sin(timeRef.current * 0.2) * 0.2);
        const mainGradient = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          canvas.width * 0.6 * pulseIntensity
        );

        // Dark mode gradient
        mainGradient.addColorStop(0, "rgba(91, 33, 182, 0.4)"); // Dark purple at center
        mainGradient.addColorStop(0.4, "rgba(67, 56, 202, 0.3)"); // Indigo midway
        mainGradient.addColorStop(0.6, "rgba(30, 41, 59, 0.2)"); // Slate blue
        mainGradient.addColorStop(1, "rgba(18, 24, 38, 0.0)"); // Transparent to let dark background show

        ctx.fillStyle = mainGradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Add subtle light sources that move around
        const lightCount = 3;
        for (let i = 0; i < lightCount; i++) {
          const angle = timeRef.current * 0.2 + (i / lightCount) * Math.PI * 2;
          const distance = canvas.width * 0.2 * (0.5 + Math.sin(timeRef.current * 0.3 + i) * 0.3);

          const lightX = centerX + Math.cos(angle) * distance;
          const lightY = centerY + Math.sin(angle) * distance;

          const lightGradient = ctx.createRadialGradient(
            lightX,
            lightY,
            0,
            lightX,
            lightY,
            canvas.width * 0.4
          );

          // Use different colors for each light
          const alpha = 0.12 + Math.sin(timeRef.current + i) * 0.06;
          if (i === 0) {
            lightGradient.addColorStop(0, `rgba(192, 132, 252, ${alpha})`); // Purple
            lightGradient.addColorStop(1, "rgba(192, 132, 252, 0)");
          } else if (i === 1) {
            lightGradient.addColorStop(0, `rgba(129, 140, 248, ${alpha})`); // Indigo
            lightGradient.addColorStop(1, "rgba(129, 140, 248, 0)");
          } else {
            lightGradient.addColorStop(0, `rgba(244, 114, 182, ${alpha})`); // Pink
            lightGradient.addColorStop(1, "rgba(244, 114, 182, 0)");
          }

          ctx.fillStyle = lightGradient;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      };

      createDynamicBackground();

      // Update and draw particles
      updateParticles(ctx, deltaTime, centerX, centerY);

      // Draw main visualization elements
      if (isRecording) {
        // Draw spectrum visualization with improved style
        const drawCircularSpectrum = () => {
          const barCount = Math.min(frequencyData.length, 180); // Limit for performance
          const baseRadius = Math.min(canvas.width, canvas.height) * 0.22; // Reduced from 0.25 to 0.22

          // Draw circular frequency bars with enhanced styling
          ctx.save();

          // Add impact effect on sudden audio change
          if (suddenImpact > 0.08) {
            ctx.shadowBlur = 30 * suddenImpact;
            ctx.shadowColor = "rgba(236, 72, 153, 0.7)"; // Pink glow on impact

            // Add particles on impact
            const impactParticles = Math.floor(suddenImpact * 20);
            for (let i = 0; i < impactParticles; i++) {
              particlesRef.current.push(createParticle(false, centerX, centerY, suddenImpact * 5));
            }
          }

          // Draw frequency bars
          for (let i = 0; i < barCount; i++) {
            const value = frequencyData[i];
            const angle = (i / barCount) * Math.PI * 2;

            // Make the visualization more dynamic - higher frequencies have more variation
            const frequencyFactor = 0.5 + (i / barCount) * 1.5;
            const amplifiedValue = Math.pow(value, 1.5) * frequencyFactor;

            // Calculate bar dimensions
            const barHeight = baseRadius * 0.2 + amplifiedValue * baseRadius * 0.8;
            const barWidth = ((Math.PI * 2 * baseRadius) / barCount) * 1.2; // Slightly overlapping

            // Bar start and end points
            const innerRadius = baseRadius * (0.8 - amplifiedValue * 0.1); // Inner radius contracts with sound
            const outerRadius = innerRadius + barHeight;

            const x1 = centerX + Math.cos(angle) * innerRadius;
            const y1 = centerY + Math.sin(angle) * innerRadius;
            const x2 = centerX + Math.cos(angle) * outerRadius;
            const y2 = centerY + Math.sin(angle) * outerRadius;

            // Create gradient for each bar
            const gradient = ctx.createLinearGradient(x1, y1, x2, y2);

            // Use more sophisticated color mapping based on frequency
            const hue = 260 + (i / barCount) * 60; // 260-320 range (purples to magentas)
            const saturation = 80 + value * 20;
            const lightness = 50 + value * 30;
            const alpha = 0.5 + value * 0.5;

            gradient.addColorStop(
              0,
              `hsla(${hue}, ${saturation}%, ${lightness - 20}%, ${alpha * 0.3})`
            );
            gradient.addColorStop(0.5, `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`);
            gradient.addColorStop(
              1,
              `hsla(${hue}, ${saturation}%, ${lightness + 20}%, ${alpha * 0.8})`
            );

            // Draw bar with rounded caps for smoother look
            ctx.beginPath();
            ctx.strokeStyle = gradient;
            ctx.lineWidth = barWidth;
            ctx.lineCap = "round";
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);

            // Add glow proportional to value
            ctx.shadowBlur = 10 * value;
            ctx.shadowColor = `hsla(${hue}, 100%, 70%, 0.7)`;

            ctx.stroke();

            // Add particles at the end of loud frequency bars
            if (value > 0.7 && Math.random() < value * 0.05) {
              particlesRef.current.push(createParticle(false, x2, y2, value));
            }
          }

          // Add connecting elements between the bars
          ctx.beginPath();
          ctx.lineWidth = 2;

          const pathPoints: [number, number][] = [];

          for (let i = 0; i < barCount; i++) {
            const value = frequencyData[i];
            const angle = (i / barCount) * Math.PI * 2;
            const radius = baseRadius * (1 + value * 0.8);

            const x = centerX + Math.cos(angle) * radius;
            const y = centerY + Math.sin(angle) * radius;

            pathPoints.push([x, y]);
          }

          // Draw a smooth curve through all points
          ctx.beginPath();
          ctx.moveTo(pathPoints[0][0], pathPoints[0][1]);

          for (let i = 0; i < pathPoints.length; i++) {
            const current = pathPoints[i];
            const next = pathPoints[(i + 1) % pathPoints.length];

            // Calculate control points for smooth curve
            const xc = (current[0] + next[0]) / 2;
            const yc = (current[1] + next[1]) / 2;

            ctx.quadraticCurveTo(current[0], current[1], xc, yc);
          }

          // Create gradient for the connecting curve
          const strokeGradient = ctx.createLinearGradient(
            centerX - baseRadius,
            centerY - baseRadius,
            centerX + baseRadius,
            centerY + baseRadius
          );

          strokeGradient.addColorStop(0, "rgba(192, 132, 252, 0.4)");
          strokeGradient.addColorStop(0.5, "rgba(129, 140, 248, 0.3)");
          strokeGradient.addColorStop(1, "rgba(236, 72, 153, 0.4)");

          ctx.strokeStyle = strokeGradient;
          ctx.lineWidth = 2;
          ctx.stroke();

          // Add a subtle fill
          const fillGradient = ctx.createRadialGradient(
            centerX,
            centerY,
            baseRadius * 0.5,
            centerX,
            centerY,
            baseRadius * 1.5
          );

          fillGradient.addColorStop(0, "rgba(192, 132, 252, 0.03)");
          fillGradient.addColorStop(0.7, "rgba(129, 140, 248, 0.02)");
          fillGradient.addColorStop(1, "rgba(236, 72, 153, 0.01)");

          ctx.fillStyle = fillGradient;
          ctx.fill();

          ctx.restore();
        };

        drawCircularSpectrum();

        // Add central element that pulses with the beat
        const drawCentralElement = () => {
          const bassValue = frequencyData.slice(0, 10).reduce((sum, val) => sum + val, 0) / 10;
          const pulseSize = 5 + bassValue * 40;

          // Multi-layered central element
          for (let i = 0; i < 3; i++) {
            const size = pulseSize * (1 - i * 0.2);
            const alpha = 0.7 - i * 0.2;

            ctx.beginPath();
            ctx.arc(centerX, centerY, size, 0, Math.PI * 2);

            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, size);

            gradient.addColorStop(0, `rgba(236, 72, 153, ${alpha})`); // Pink core
            gradient.addColorStop(0.5, `rgba(192, 132, 252, ${alpha * 0.8})`); // Purple mid
            gradient.addColorStop(1, `rgba(129, 140, 248, ${alpha * 0.1})`); // Indigo edge

            ctx.fillStyle = gradient;
            ctx.shadowBlur = 20 * bassValue;
            ctx.shadowColor = "rgba(236, 72, 153, 0.8)";
            ctx.fill();
          }
        };

        drawCentralElement();
      } else {
        // Idle animation when not recording
        const drawIdleAnimation = () => {
          const idleRadius = Math.min(canvas.width, canvas.height) * 0.22;

          // Multiple layers of animated circles
          for (let layer = 0; layer < 3; layer++) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(192, 132, 252, ${0.4 - layer * 0.1})`;
            ctx.lineWidth = 3 - layer * 0.7;

            const layerPoints = 120;
            const layerOffset = (layer * Math.PI) / 6;
            const layerSpeed = 1 - layer * 0.2;
            const layerRadius = idleRadius * (1 + layer * 0.15);

            ctx.beginPath();

            for (let i = 0; i < layerPoints; i++) {
              const angle = (i / layerPoints) * Math.PI * 2;
              const noise1 = Math.sin(angle * 5 + timeRef.current * layerSpeed) * 5;
              const noise2 = Math.cos(angle * 7 + timeRef.current * layerSpeed * 1.5) * 5;
              const wobble = noise1 + noise2;

              const x = centerX + Math.cos(angle + layerOffset) * (layerRadius + wobble);
              const y = centerY + Math.sin(angle + layerOffset) * (layerRadius + wobble);

              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }

            ctx.closePath();
            ctx.stroke();

            // Add subtle glow
            ctx.shadowBlur = 10;
            ctx.shadowColor = "rgba(192, 132, 252, 0.5)";
          }

          // Pulsating center
          const pulseSize = 8 + Math.sin(timeRef.current) * 4;

          // Multi-layered central dot
          for (let i = 0; i < 3; i++) {
            const size = pulseSize * (1 - i * 0.2);
            ctx.beginPath();
            ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(192, 132, 252, ${0.7 - i * 0.2})`;
            ctx.shadowBlur = 15;
            ctx.shadowColor = "rgba(192, 132, 252, 0.8)";
            ctx.fill();
          }
        };

        drawIdleAnimation();
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [mediaStream, isRecording, isDarkMode]);

  return (
    <div className={`w-full flex justify-center items-center overflow-visible ${className || ""}`}>
      <div className="p-4 w-full h-full">
        <div className="w-full h-full mx-auto relative">
          {/* Outer background circle */}
          <div
            className={`absolute inset-0 rounded-full ${isDarkMode ? "bg-gray-900" : "bg-white"}`}
            style={{
              background: isDarkMode
                ? "linear-gradient(135deg, rgba(17, 24, 39, 0.4) 0%, rgba(17, 24, 39, 0.2) 100%)"
                : "white",
              transform: "scale(1.08)",
              zIndex: -1,
              boxShadow: isDarkMode
                ? "inset 0 0 30px rgba(0, 0, 0, 0.5)"
                : "inset 0 0 10px rgba(0, 0, 0, 0.05)",
            }}
          ></div>
          {/* Canvas for visualization */}
          <canvas
            ref={canvasRef}
            className={`w-full h-full rounded-full ${isDarkMode ? "bg-gray-900" : "bg-white"}`}
            style={{
              boxShadow: isDarkMode ? "inset 0 0 20px rgba(13, 18, 30, 0.8)" : "none",
              background: isDarkMode
                ? "linear-gradient(135deg, rgba(13, 18, 30, 1) 0%, rgba(13, 18, 30, 1) 100%)"
                : "white",
            }}
          />
        </div>
      </div>
    </div>
  );
}
