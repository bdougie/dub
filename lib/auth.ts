import { NextApiRequest, NextApiResponse } from "next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { unstable_getServerSession } from "next-auth/next";
import { FREE_PLAN_PROJECT_LIMIT } from "@/lib/constants";
import prisma from "@/lib/prisma";
import { ProjectProps, UsageProps, UserProps } from "@/lib/types";

interface Session {
  user: {
    email?: string | null;
    id?: string | null;
    name?: string | null;
  };
}

export async function getSession(req: NextApiRequest, res: NextApiResponse) {
  const session = (await unstable_getServerSession(
    req,
    res,
    authOptions,
  )) as Session | null;
  return session;
}

interface WithProjectNextApiHandler {
  (
    req: NextApiRequest,
    res: NextApiResponse,
    project?: ProjectProps,
  ): Promise<void>;
}

const withProjectAuth =
  (
    handler: WithProjectNextApiHandler,
    {
      excludeGet, // if the action doesn't need to be gated for GET requests
      needVerifiedDomain, // if the action needs a verified domain
      needProSubscription, // if the action needs a pro subscription
      needNotExceededUsage, // if the action needs the user to not have exceeded their usage
    }: {
      excludeGet?: boolean;
      needVerifiedDomain?: boolean;
      needProSubscription?: boolean;
      needNotExceededUsage?: boolean;
    } = {},
  ) =>
  async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getSession(req, res);
    if (!session?.user.id) return res.status(401).end("Unauthorized");

    const { slug } = req.query;
    if (!slug || typeof slug !== "string") {
      return res
        .status(400)
        .json({ error: "Missing or misconfigured project slug" });
    }

    const project = (await prisma.project.findFirst({
      where: {
        slug,
        users: {
          some: {
            userId: session.user.id,
          },
        },
      },
      select: {
        name: true,
        slug: true,
        domain: true,
        domainVerified: true,
        logo: true,
        ownerUsageLimit: true,
        ownerExceededUsage: true,
        users: {
          where: {
            userId: session.user.id,
          },
          select: {
            role: true,
          },
        },
      },
    })) as ProjectProps;

    if (!project) return res.status(404).json({ error: "Project not found" });

    // if the action doesn't need to be gated for GET requests, return handler now
    if (req.method === "GET" && excludeGet) return handler(req, res, project);

    // if the action needs a verified domain, check if the project has one, if not return 403
    if (needVerifiedDomain && !project.domainVerified) {
      return res.status(403).json({ error: "Domain not verified." });
    }

    if (needNotExceededUsage || needProSubscription) {
      const user = (await prisma.user.findUnique({
        where: {
          id: session.user.id,
        },
        select: {
          usage: true,
          usageLimit: true,
        },
      })) as UsageProps;

      if (needNotExceededUsage && project.ownerExceededUsage) {
        return res.status(403).end("Unauthorized: Usage limits exceeded.");
      }

      const freePlan = project.ownerUsageLimit === 1000;
      if (needProSubscription && freePlan) {
        return res.status(403).end("Unauthorized: Need pro subscription");
      }
    }

    return handler(req, res, project);
  };

export { withProjectAuth };

interface WithUsertNextApiHandler {
  (
    req: NextApiRequest,
    res: NextApiResponse,
    userId: string,
    user?: UserProps,
  ): Promise<void>;
}

const withUserAuth =
  (
    handler: WithUsertNextApiHandler,
    {
      needUserDetails, // if the action needs the user's details
      needProSubscription, // if the action needs a pro subscription
    }: {
      needUserDetails?: boolean;
      needProSubscription?: boolean;
    } = {},
  ) =>
  async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getSession(req, res);
    if (!session?.user.id) return res.status(401).end("Unauthorized");

    if (req.method === "GET") return handler(req, res, session.user.id);

    if (needUserDetails || needProSubscription) {
      const user = (await prisma.user.findUnique({
        where: {
          id: session.user.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          stripeId: true,
          usageLimit: true,
          ...(needProSubscription && {
            projects: {
              where: {
                role: "owner",
              },
              select: {
                projectId: true,
              },
            },
          }),
        },
      })) as UserProps;

      const freePlan = user.usageLimit === 1000;
      if (
        needProSubscription &&
        freePlan &&
        user.projects.length >= FREE_PLAN_PROJECT_LIMIT
      ) {
        return res
          .status(403)
          .end("Unauthorized: Can't add more projects, need pro subscription");
      }

      return handler(req, res, session.user.id, user);
    }

    return handler(req, res, session.user.id);
  };

export { withUserAuth };
