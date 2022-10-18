import { NextApiRequest, NextApiResponse } from "next";
import { withProjectAuth } from "@/lib/auth";
import { getLinkCountForProject } from "@/lib/upstash";

export default withProjectAuth(
  async (req: NextApiRequest, res: NextApiResponse) => {
    // GET /api/projects/[slug]/domains/[domain]/links/count – count the number of links for a project
    if (req.method === "GET") {
      const { domain } = req.query as { domain: string };
      if (!domain) {
        return res.status(400).json({ error: "Missing hostname" });
      }
      const count = await getLinkCountForProject(domain);
      return res.status(200).json(count);
    } else {
      res.setHeader("Allow", ["GET"]);
      return res
        .status(405)
        .json({ error: `Method ${req.method} Not Allowed` });
    }
  },
);
