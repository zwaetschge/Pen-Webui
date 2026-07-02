import { expect, test } from "@playwright/test";

test("public landing page renders without an authenticated session", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Roll for Initiative" }),
  ).toBeVisible();
  await expect(page.getByText("Authelia handles the door.")).toBeVisible();
});

test("SRD browser shell renders", async ({ page }) => {
  await page.goto("/srd");

  await expect(
    page.getByRole("heading", { name: "D&D 5.1 SRD" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder(/fireball, owlbear, grapple/),
  ).toBeVisible();
});

test("protected DM API routes reject direct unauthenticated access", async ({
  request,
}) => {
  const response = await request.get("/api/dm/settings");

  expect(response.status()).toBe(401);
  expect(await response.json()).toMatchObject({
    error: "unauthenticated",
  });
});
