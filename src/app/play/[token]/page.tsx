import { PlayInviteJoin } from "../_components/PlayInviteJoin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function PlayJoinPage({ params }: Props) {
  const { token } = await params;
  return <PlayInviteJoin token={token} />;
}
