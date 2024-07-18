import { $path } from "@ignisda/remix-routes";
import { redirect, unstable_defineLoader } from "@remix-run/node";
import { ProcessAccessLinkDocument } from "@ryot/generated/graphql/backend/graphql";
import { safeRedirect } from "remix-utils/safe-redirect";
import { z } from "zod";
import { zx } from "zodix";
import { redirectToQueryParam } from "~/lib/generals";
import {
	createToastHeaders,
	getCookiesForApplication,
	serverGqlService,
} from "~/lib/utilities.server";

const paramsSchema = z.object({ accessLinkId: z.string() });

const searchParamsSchema = z.object({
	[redirectToQueryParam]: z.string().optional(),
});

export const loader = unstable_defineLoader(async ({ request, params }) => {
	const input = zx.parseParams(params, paramsSchema);
	const { processAccessLink } = await serverGqlService.request(
		ProcessAccessLinkDocument,
		input,
	);
	if (processAccessLink.__typename === "ProcessAccessLinkResponse") {
		const queryParams = zx.parseQuery(request, searchParamsSchema);
		const headers = await getCookiesForApplication(
			processAccessLink.apiKey,
			processAccessLink.tokenValidForDays,
		);
		return redirect(
			safeRedirect(queryParams[redirectToQueryParam] || $path("/")),
			{ headers },
		);
	}
	return redirect($path("/auth"), {
		headers: await createToastHeaders({
			type: "error",
			title: "Error processing access link",
			message: `Encountered: ${processAccessLink.error}`,
		}),
	});
});
