"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

export interface NavEntry {
  label: string;
  href: string;
}

export function SidebarNav({ items }: { items: NavEntry[] }) {
  const [activeHref, setActiveHref] = useState(items[0]?.href ?? "");
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const sectionIds = items
      .map((i) => i.href)
      .filter((h) => h.startsWith("#"))
      .map((h) => h.slice(1));

    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter(Boolean) as HTMLElement[];

    if (elements.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveHref(`#${entry.target.id}`);
            break;
          }
        }
      },
      { rootMargin: "-10% 0px -80% 0px", threshold: 0 },
    );

    for (const el of elements) {
      observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
  }, [items]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!href.startsWith("#")) return;
      e.preventDefault();
      const target = document.getElementById(href.slice(1));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", href);
        setActiveHref(href);
      }
    },
    [],
  );

  return (
    <nav className="nav-list">
      {items.map((item) => {
        const isHash = item.href.startsWith("#");
        return (
          <a
            key={item.href}
            className={`nav-item${activeHref === item.href ? " active" : ""}`}
            href={item.href}
            onClick={isHash ? (e) => handleClick(e, item.href) : undefined}
          >
            {item.label}
            {!isHash ? " ↗" : null}
          </a>
        );
      })}
    </nav>
  );
}
