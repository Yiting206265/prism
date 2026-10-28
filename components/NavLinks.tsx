'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'arXiv' },
  { href: '/custom', label: 'Customized' },
];

export default function NavLinks() {
  const path = usePathname();

  return (
    <>
      {LINKS.map((link) => {
        const active = link.href === '/' ? path === '/' : path.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`header-link${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
