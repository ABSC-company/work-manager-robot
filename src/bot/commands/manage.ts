import { prisma } from "../../db/prisma";
import { isSuperAdmin } from "../middleware/auth";
import type { MyContext } from "../instance";

export async function listCompanies(ctx: MyContext): Promise<void> {
  const telegramId = String(ctx.from!.id);

  const companies = isSuperAdmin(telegramId)
    ? await prisma.company.findMany({ orderBy: { name: "asc" } })
    : (await prisma.companyAdmin.findMany({ where: { telegramId }, include: { company: true } })).map((m) => m.company);

  if (companies.length === 0) {
    await ctx.reply("Компаний не найдено.");
    return;
  }

  await ctx.reply(companies.map((c) => `${c.id} — ${c.name}`).join("\n"));
}

export async function listProjects(ctx: MyContext): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const projects = await prisma.project.findMany({ where: { companyId }, orderBy: { name: "asc" } });

  if (projects.length === 0) {
    await ctx.reply("В компании пока нет проектов. Создайте через /addproject.");
    return;
  }

  await ctx.reply(projects.map((p) => `${p.id} — ${p.name}`).join("\n"));
}

export async function listDirections(ctx: MyContext): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const directions = await prisma.direction.findMany({
    where: { project: { companyId } },
    include: { project: true },
    orderBy: [{ project: { name: "asc" } }, { name: "asc" }],
  });

  if (directions.length === 0) {
    await ctx.reply("В компании пока нет направлений. Создайте через /adddirection.");
    return;
  }

  await ctx.reply(directions.map((d) => `${d.id} — ${d.project.name} / ${d.name}`).join("\n"));
}

export async function deleteProject(ctx: MyContext, projectId: string): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.companyId !== companyId) {
    await ctx.reply("Проект с таким id не найден в этой компании.");
    return;
  }
  await prisma.project.delete({ where: { id: projectId } });
  await ctx.reply(`Проект "${project.name}" и всё связанное с ним (направления, отчёты) удалены.`);
}

export async function deleteDirection(ctx: MyContext, directionId: string): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const direction = await prisma.direction.findUnique({ where: { id: directionId }, include: { project: true } });
  if (!direction || direction.project.companyId !== companyId) {
    await ctx.reply("Направление с таким id не найдено в этой компании.");
    return;
  }
  await prisma.direction.delete({ where: { id: directionId } });
  await ctx.reply(`Направление "${direction.name}" удалено.`);
}

export async function deleteEmployee(ctx: MyContext, employeeId: string): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee || employee.companyId !== companyId) {
    await ctx.reply("Сотрудник с таким id не найден в этой компании.");
    return;
  }
  await prisma.employee.delete({ where: { id: employeeId } });
  await ctx.reply(`Сотрудник "${employee.fullName}" удалён.`);
}

export async function deleteAdmin(ctx: MyContext, telegramId: string): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const membership = await prisma.companyAdmin.findUnique({
    where: { companyId_telegramId: { companyId, telegramId } },
  });
  if (!membership) {
    await ctx.reply("Этот пользователь не является администратором компании.");
    return;
  }

  const adminCount = await prisma.companyAdmin.count({ where: { companyId } });
  if (adminCount <= 1) {
    await ctx.reply("Нельзя удалить последнего администратора компании.");
    return;
  }

  await prisma.companyAdmin.delete({ where: { companyId_telegramId: { companyId, telegramId } } });
  await ctx.reply(`Администратор (id ${telegramId}) удалён из компании.`);
}

export async function deleteOccasion(ctx: MyContext, occasionId: string): Promise<void> {
  const companyId = ctx.session.activeCompanyId!;
  const occasion = await prisma.occasion.findUnique({ where: { id: occasionId } });
  if (!occasion || occasion.companyId !== companyId) {
    await ctx.reply("Мероприятие с таким id не найдено в этой компании.");
    return;
  }
  await prisma.occasion.delete({ where: { id: occasionId } });
  await ctx.reply(`Мероприятие "${occasion.title}" удалено.`);
}

/** Super-admin only. Requires the company name as confirmation to avoid accidental full wipeouts. */
export async function deleteCompany(ctx: MyContext, companyId: string, confirmName: string | undefined): Promise<void> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) {
    await ctx.reply("Компания с таким id не найдена.");
    return;
  }
  if (confirmName !== company.name) {
    await ctx.reply(
      `Это удалит компанию "${company.name}" и ВСЕ связанные данные (проекты, сотрудники, отчёты, расписания).\n` +
        `Чтобы подтвердить, повторите команду с точным названием компании:\n` +
        `/deletecompany ${companyId} ${company.name}`
    );
    return;
  }
  await prisma.company.delete({ where: { id: companyId } });
  await ctx.reply(`Компания "${company.name}" и все связанные данные удалены.`);
}
