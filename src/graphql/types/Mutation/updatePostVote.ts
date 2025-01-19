import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { postVotesTable } from "~/src/drizzle/tables/postVotes";
import { builder } from "~/src/graphql/builder";
import {
	MutationUpdatePostVoteInput,
	mutationUpdatePostVoteInputSchema,
} from "~/src/graphql/inputs/MutationUpdatePostVoteInput";
import { Post } from "~/src/graphql/types/Post/Post";
import { TalawaGraphQLError } from "~/src/utilities/TalawaGraphQLError";

const mutationUpdatePostVoteArgumentsSchema = z.object({
	input: mutationUpdatePostVoteInputSchema,
});

builder.mutationField("updatePostVote", (t) =>
	t.field({
		args: {
			input: t.arg({
				description: "",
				required: true,
				type: MutationUpdatePostVoteInput,
			}),
		},
		description: "Mutation field to update a post vote.",
		resolve: async (_parent, args, ctx) => {
			if (!ctx.currentClient.isAuthenticated) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unauthenticated",
					},
				});
			}

			const {
				data: parsedArgs,
				error,
				success,
			} = mutationUpdatePostVoteArgumentsSchema.safeParse(args);

			if (!success) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "invalid_arguments",
						issues: error.issues.map((issue) => ({
							argumentPath: issue.path,
							message: issue.message,
						})),
					},
				});
			}

			const currentUserId = ctx.currentClient.user.id;

			const [currentUser, existingPost, existingPostVote] = await Promise.all([
				ctx.drizzleClient.query.usersTable.findFirst({
					columns: {
						role: true,
					},
					where: (fields, operators) => operators.eq(fields.id, currentUserId),
				}),
				ctx.drizzleClient.query.postsTable.findFirst({
					with: {
						organization: {
							columns: {
								countryCode: true,
							},
							with: {
								organizationMembershipsWhereOrganization: {
									columns: {
										role: true,
									},
									where: (fields, operators) =>
										operators.eq(fields.memberId, currentUserId),
								},
							},
						},
						postAttachmentsWherePost: true,
					},
					where: (fields, operators) =>
						operators.eq(fields.id, parsedArgs.input.postId),
				}),
				ctx.drizzleClient.query.postVotesTable.findFirst({
					columns: {
						type: true,
					},
					where: (fields, operators) =>
						operators.and(
							operators.eq(fields.creatorId, currentUserId),
							operators.eq(fields.postId, parsedArgs.input.postId),
						),
				}),
			]);

			if (currentUser === undefined) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unauthenticated",
					},
				});
			}

			if (existingPost === undefined || existingPostVote === undefined) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "arguments_associated_resources_not_found",
						issues: [
							{
								argumentPath: ["input", "postId"],
							},
						],
					},
				});
			}
			const currentUserOrganizationMembership =
				existingPost.organization.organizationMembershipsWhereOrganization[0];

			if (
				currentUser.role !== "administrator" &&
				currentUserOrganizationMembership === undefined
			) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unauthorized_action_on_arguments_associated_resources",
						issues: [
							{
								argumentPath: ["input", "postId"],
							},
						],
					},
				});
			}

			const [updatedPostVote] = await ctx.drizzleClient
				.update(postVotesTable)
				.set({
					type: parsedArgs.input.type,
					updaterId: currentUserId,
				})
				.where(
					and(
						eq(postVotesTable.creatorId, currentUserId),
						eq(postVotesTable.postId, parsedArgs.input.postId),
					),
				)
				.returning();

			// Updated post vote not being returned means that either it was deleted or its `creatorId` or `postId` columns were changed by external entities before this update operation.
			if (updatedPostVote === undefined) {
				throw new TalawaGraphQLError({
					extensions: {
						code: "unexpected",
					},
				});
			}

			return Object.assign(existingPost, {
				attachments: existingPost.postAttachmentsWherePost,
			});
		},
		type: Post,
	}),
);