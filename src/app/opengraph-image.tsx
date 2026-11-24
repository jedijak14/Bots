import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          padding: 72,
          background: "#060608",
          backgroundImage:
            "radial-gradient(900px 620px at 8% -10%, rgba(124,140,255,0.22), transparent 62%), radial-gradient(700px 520px at 100% 110%, rgba(139,92,246,0.18), transparent 60%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 84,
              height: 84,
              borderRadius: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              backgroundImage: "linear-gradient(135deg, #9DBBFF 0%, #7C8CFF 55%, #8B5CF6 100%)",
            }}
          >
            <div style={{ width: 15, height: 30, borderRadius: 8, background: "#07070A" }} />
            <div style={{ width: 15, height: 30, borderRadius: 8, background: "#07070A" }} />
          </div>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 600, letterSpacing: -2 }}>{BRAND.name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 600, letterSpacing: -3.4, lineHeight: 1.05 }}>
            Bots with their own
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 600, letterSpacing: -3.4, lineHeight: 1.05 }}>
            look, memory and computer.
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#9b9ba6", marginTop: 8 }}>
            Bring your own model. Your keys stay yours.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
