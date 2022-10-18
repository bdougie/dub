import sendMail from "emails";
import InvalidDomain from "emails/InvalidDomain";
import ProjectDeleted from "emails/ProjectDeleted";
import { log } from "@/lib/cron/utils";
import { removeDomain } from "@/lib/domains";
import { deleteProject, redis } from "@/lib/upstash";

export const handleDomainUpdates = async (
  projectSlug: string,
  domain: string,
  createdAt: Date,
  verified: boolean,
  changed: boolean,
  sentEmails: string[],
) => {
  if (changed) {
    await log(`Domain *${domain}* changed status to *${verified}*`);
  }

  if (verified) return;

  const invalidDays = Math.floor(
    (new Date().getTime() - new Date(createdAt).getTime()) / (1000 * 3600 * 24),
  );

  if (invalidDays >= 14 && invalidDays < 28) {
    const sentFirstDomainInvalidEmail = sentEmails.includes(
      "firstDomainInvalidEmail",
    );
    if (!sentFirstDomainInvalidEmail) {
      sendDomainInvalidEmail(projectSlug, domain, invalidDays, "first");
    }
  } else if (invalidDays >= 28) {
    const sentSecondDomainInvalidEmail = sentEmails.includes(
      "secondDomainInvalidEmail",
    );
    if (!sentSecondDomainInvalidEmail) {
      sendDomainInvalidEmail(projectSlug, domain, invalidDays, "second");
    }
  }

  if (invalidDays >= 30) {
    const hasLinks = await redis.exists(`${domain}:links`);
    if (hasLinks === 0) {
      // only delete if there are no resources recorded (links, stats, etc.)
      const ownerEmail = await getProjectOwnerEmail(projectSlug);
      return await Promise.all([
        prisma.project.delete({
          where: {
            domain,
          },
        }),
        removeDomain(domain),
        deleteProject(domain),
        log(`Domain *${domain}* has been invalid for > 30 days, deleting.`),
        sendMail({
          subject: `Your project ${projectSlug} has been deleted`,
          to: ownerEmail,
          component: (
            <ProjectDeleted domain={domain} projectSlug={projectSlug} />
          ),
        }),
      ]);
    } else {
      return await log(
        `Domain *${domain}* has been invalid for > 30 days but has links, not deleting.`,
      );
    }
  }
  return;
};

const sendDomainInvalidEmail = async (
  projectSlug: string,
  domain: string,
  invalidDays: number,
  type: "first" | "second",
) => {
  const ownerEmail = await getProjectOwnerEmail(projectSlug);
  return await Promise.all([
    log(`Domain *${domain}* is invalid for ${invalidDays} days, email sent.`),
    sendMail({
      subject: `Your domain ${domain} needs to be configured`,
      to: ownerEmail,
      component: (
        <InvalidDomain
          domain={domain}
          projectSlug={projectSlug}
          invalidDays={invalidDays}
        />
      ),
    }),
    prisma.sentEmail.create({
      data: {
        project: {
          connect: {
            slug: projectSlug,
          },
        },
        type: `${type}DomainInvalidEmail`,
      },
    }),
  ]);
};

const getProjectOwnerEmail = async (projectSlug: string) => {
  const owner = await prisma.project.findUnique({
    where: { slug: projectSlug },
    select: {
      users: {
        where: {
          role: "owner",
        },
        select: {
          user: {
            select: {
              email: true,
            },
          },
        },
      },
    },
  });
  return owner?.users[0].user.email;
};
