import React, { useEffect, useState } from "react";

const CyberpunkCursor: React.FC = () => {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [cursorType, setCursorType] = useState("default");

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });

      const target = e.target as HTMLElement;
      if (
        target.tagName === "A" ||
        target.tagName === "BUTTON" ||
        target.getAttribute("role") === "button"
      ) {
        setCursorType("pointer");
      } else if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        setCursorType("text");
      } else {
        setCursorType("default");
      }
    };

    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div
      className={`custom-cursor ${
        cursorType === "pointer"
          ? "pointer"
          : cursorType === "text"
          ? "text"
          : ""
      }`}
      style={{
        left: `${pos.x}px`,
        top: `${pos.y}px`,
      }}
    />
  );
};

export default CyberpunkCursor;
