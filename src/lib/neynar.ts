import { validateEnvironment } from "../helpers/client";
import fetch from "node-fetch";

const { NEYNAR_API_KEY } = validateEnvironment(["NEYNAR_API_KEY"]);

export interface NeynarUser {
  fid: string;
  username: string;
  display_name: string;
  pfp_url: string;
  custody_address: string;
  verifications: string[];
}

export const fetchUsersByAddresses = async (
  addresses: string[]
): Promise<string[]> => {
  if (addresses.length > 350) {
    throw new Error("Maximum of 350 addresses allowed per request");
  }

  const response = await fetch(
    `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${addresses.join(
      ","
    )}`,
    {
      headers: {
        "x-api-key": NEYNAR_API_KEY!,
      },
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch Farcaster users by addresses on Neynar");
  }

  const data = await response.json();

  // Extract only usernames from the response
  const usernames = Object.values(data)
    .flat()
    .map((user: any) => user.username);
  console.log("Usernames:", usernames);
  return usernames;
};
