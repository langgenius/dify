"use client"

import {signIn} from "next-auth/react";
import GoogleButton from "react-google-button";

export default function Page() {
    return (
        <div className={'flex w-full h-screen align-items-center justify-content-center'}>
            <GoogleButton onClick={() => signIn('google', { callbackUrl: '/user' })}/>
        </div>
    )
}
