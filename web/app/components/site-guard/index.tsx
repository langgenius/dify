'use client'
import React, { memo, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const SiteGuard = () => {
  const router = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [promptShown, setPromptShown] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      if (router.startsWith('/chat') && !promptShown) {
        const password = prompt('Enter password:');
        setPromptShown(true);

        if (password === 'cit2024') {
          setIsAuthenticated(true);
        } else {
          alert('Invalid password');
          setIsAuthenticated(false);
        }
      } else {
        setIsAuthenticated(true);
      }
      setIsCheckingAuth(false);
    };

    checkAuth();
  }, [router, promptShown]);

  if (isCheckingAuth) {
    return <div style={{ height: '100vh', backgroundColor: 'white' }} />;
  }
  if (!isAuthenticated) {
    return <div style={{ height: '100vh', backgroundColor: 'white' }} />;
  }

  return <></>;
}

export default memo(SiteGuard);