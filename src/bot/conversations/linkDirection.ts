import type { Conversation } from "@grammyjs/conversations";
import type { MyContext } from "../instance";
import { prisma } from "../../db/prisma";
import path from "node:path";
import fs from "node:fs/promises";
import { config } from "../../config";
import { waitFor, runCancellable } from "./_helpers";

export async function linkDirectionConversation(conversation: Conversation<MyContext, MyContext>, ctx: MyContext): Promise<void> {
  return runCancellable(async () => {
    const companyId = (await conversation.external((ctx) => ctx.session.activeCompanyId))!;

    const directions = await conversation.external(() =>
      prisma.direction.findMany({ where: { project: { companyId } }, include: { project: true } })
    );
    if (directions.length === 0) {
      await ctx.reply("В компании нет направлений. Создайте через /adddirection.");
      return;
    }

    await ctx.reply(
      "Выберите направление, указав id (/cancel — отменить):\n" +
        directions.map((d) => `${d.id} — ${d.project.name} / ${d.name}`).join("\n")
    );
    const dirMsg = await waitFor(conversation, ctx, "message:text");
    const directionId = dirMsg.message.text.trim();
    const direction = directions.find((d) => d.id === directionId);
    if (!direction) {
      await ctx.reply("Направление с таким id не найдено. Отменено.");
      return;
    }

    // 1. Employees
    const employees = await conversation.external(() => prisma.employee.findMany({ where: { companyId } }));
    if (employees.length > 0) {
      await ctx.reply(
        "Сотрудники компании (укажите id через запятую для привязки к направлению, или '-' чтобы пропустить):\n" +
          employees.map((e) => `${e.id} — ${e.fullName}`).join("\n")
      );
      const empMsg = await waitFor(conversation, ctx, "message:text");
      const raw = empMsg.message.text.trim();
      if (raw !== "-") {
        const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
        await conversation.external(() =>
          Promise.all(
            ids.map((employeeId) =>
              prisma.directionEmployee.upsert({
                where: { directionId_employeeId: { directionId: direction.id, employeeId } },
                create: { directionId: direction.id, employeeId },
                update: {},
              })
            )
          )
        );
        await ctx.reply(`Привязано сотрудников: ${ids.length}.`);
      }
    }

    // 2. GitHub repos (one or more, comma-separated)
    await ctx.reply(
      `Введите рабочие GitHub-репозитории в формате owner/repo, через запятую если несколько ` +
        `(текущие: ${direction.githubRepos.length > 0 ? direction.githubRepos.join(", ") : "не заданы"}), или '-' чтобы пропустить:`
    );
    const repoMsg = await waitFor(conversation, ctx, "message:text");
    const repoRaw = repoMsg.message.text.trim();
    if (repoRaw !== "-") {
      const repos = repoRaw.split(",").map((s) => s.trim()).filter(Boolean);
      await conversation.external(() => prisma.direction.update({ where: { id: direction.id }, data: { githubRepos: repos } }));
      await ctx.reply(`Сохранено репозиториев: ${repos.length}.`);
    }

    // 3. Jira project key + boards
    await ctx.reply(`Введите ключ Jira-проекта (например PROJ), текущий: ${direction.jiraProjectKey ?? "не задан"}, или '-' чтобы пропустить:`);
    const keyMsg = await waitFor(conversation, ctx, "message:text");
    const keyRaw = keyMsg.message.text.trim();
    if (keyRaw !== "-") {
      await conversation.external(() => prisma.direction.update({ where: { id: direction.id }, data: { jiraProjectKey: keyRaw } }));
    }

    await ctx.reply("Введите id досок Jira через запятую (если несколько), или '-' чтобы пропустить:");
    const boardsMsg = await waitFor(conversation, ctx, "message:text");
    const boardsRaw = boardsMsg.message.text.trim();
    if (boardsRaw !== "-") {
      const boardIds = boardsRaw.split(",").map((s) => s.trim()).filter(Boolean);
      await conversation.external(() => prisma.direction.update({ where: { id: direction.id }, data: { jiraBoardIds: boardIds } }));
    }

    // 4. Documentation: a .txt/.docx file, or one/more GitHub repo links (comma-separated).
    // Private repos are read via the company's linked GitHub org token (see /setgithub) — public repos work the same way.
    await ctx.reply(
      "Документация направления: отправьте .txt/.docx файл, либо одну или несколько ссылок на GitHub-репозитории " +
        "через запятую (публичные или приватные — приватные читаются через привязанный /setgithub токен), либо '-' чтобы пропустить:"
    );
    const docMsg = await waitFor(conversation, ctx, ["message:document", "message:text"]);

    if (docMsg.message.document) {
      const file = await ctx.api.getFile(docMsg.message.document.file_id);
      const ext = path.extname(docMsg.message.document.file_name ?? "").toLowerCase();
      if (![".txt", ".docx"].includes(ext)) {
        await ctx.reply("Поддерживаются только .txt и .docx файлы. Документация не сохранена.");
      } else {
        const destName = `${direction.id}_${Date.now()}${ext}`;
        const destPath = path.join(config.storage.uploadsDir, destName);
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(destPath, buffer);

        await conversation.external(() =>
          prisma.documentation.create({
            data: { directionId: direction.id, type: "FILE", name: docMsg.message.document!.file_name ?? destName, filePath: destPath },
          })
        );
        await ctx.reply("Файл документации сохранён.");
      }
    } else if (docMsg.message.text && docMsg.message.text.trim() !== "-") {
      const urls = docMsg.message.text.trim().split(",").map((s) => s.trim()).filter(Boolean);
      await conversation.external(() =>
        Promise.all(
          urls.map((url) => prisma.documentation.create({ data: { directionId: direction.id, type: "GITHUB_REPO", name: url, url } }))
        )
      );
      await ctx.reply(`Сохранено ссылок на документацию: ${urls.length}.`);
    }

    await ctx.reply(`Направление "${direction.name}" настроено.`);
  });
}
