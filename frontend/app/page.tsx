import View from "@/app/view";
import {getServerSession} from "next-auth";
import {redirect} from "next/navigation";

export default async  function Page() {
    const session = await getServerSession();
    if(session && session.user && session.user.email) {

        return <View email={session.user.email}></View>
    }
    redirect('/login');
}
