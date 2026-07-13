const { test, expect } = require("@playwright/test");


test.describe("Longreads", () => {


  test("longreads list page opens", async ({ page }) => {

    const response = await page.goto(
      "http://localhost:3000/longreads"
    );

    expect(response.status()).toBe(200);

    await expect(
      page.locator("h1")
    ).toBeVisible();

  });



  test("Kostya longread renders correctly", async ({ page }) => {

    const response = await page.goto(
      "http://localhost:3000/longreads/kostya-kotocafe"
    );

    expect(response.status()).toBe(200);


    await expect(
      page.locator("h1")
    ).toContainText(
      "История Кости"
    );


    // hero
    await expect(
      page.locator(".kgv-longread-hero")
    ).toBeVisible();


    // связь с программой
    await expect(
      page.locator(
        'a[href="/programms/inclucentre"]'
      )
    ).toBeVisible();


    // контент есть
    await expect(
      page.locator(".kgv-longread__content")
    ).toBeVisible();


    // Obsidian-ссылки не должны попасть в HTML
    const html =
      await page.locator(
        ".kgv-longread__content"
      ).innerHTML();


    expect(html).not.toContain(
      "![["
    );


    // responsive images
    await expect(
      page.locator(
        ".kgv-longread__content img[srcset]"
      ).first()
    ).toBeVisible();

  });


});
