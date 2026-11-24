import { ImageResponse } from "next/og";
import { BRAND } from "@/lib/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the mark alone, on a matching tile. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#060608",
          backgroundImage: "radial-gradient(420px 420px at 30% 10%, rgba(124,140,255,0.35), transparent 70%)",
        }}
      >
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            backgroundImage: "linear-gradient(135deg, #9DBBFF 0%, #7C8CFF 55%, #8B5CF6 100%)",
            boxShadow: "0 18px 40px rgba(124,140,255,0.35)",
          }}
        >
          <div style={{ width: 22, height: 46, borderRadius: 11, background: "#07070A" }} />
          <div style={{ width: 22, height: 46, borderRadius: 11, background: "#07070A" }} />
        </div>
      </div>
    ),
    { ...size },
  );
}

export const alt = `${BRAND.name} app icon`;
