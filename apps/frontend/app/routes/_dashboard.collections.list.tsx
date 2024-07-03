import { useAutoAnimate } from "@formkit/auto-animate/react";
import { $path } from "@ignisda/remix-routes";
import {
	ActionIcon,
	Anchor,
	Box,
	Button,
	Checkbox,
	Container,
	Flex,
	Group,
	Image,
	Input,
	Modal,
	MultiSelect,
	Paper,
	Select,
	Stack,
	Text,
	TextInput,
	Textarea,
	Title,
} from "@mantine/core";
import {
	useDidUpdate,
	useDisclosure,
	useHover,
	useListState,
} from "@mantine/hooks";
import { unstable_defineAction, unstable_defineLoader } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useFetcher,
	useNavigation,
	useSearchParams,
} from "@remix-run/react";
import {
	CollectionContentsDocument,
	CollectionContentsSortBy,
	type CollectionExtraInformation,
	CollectionExtraInformationLot,
	CreateOrUpdateCollectionDocument,
	DeleteCollectionDocument,
	GraphqlSortOrder,
	type UserCollectionsListQuery,
	UsersListDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { changeCase, isString, truncate } from "@ryot/ts-utils";
import {
	IconEdit,
	IconPlus,
	IconTrash,
	IconTrashFilled,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { ClientError } from "graphql-request";
import { useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { DebouncedSearchInput, ProRequiredAlert } from "~/components/common";
import { confirmWrapper } from "~/components/confirmation";
import { queryFactory, clientGqlService, dayjsLib } from "~/lib/generals";
import {
	useFallbackImageUrl,
	useUserCollections,
	useUserDetails,
} from "~/lib/hooks";
import {
	createToastHeaders,
	getAuthorizationHeader,
	processSubmission,
	removeCachedUserCollectionsList,
	serverGqlService,
} from "~/lib/utilities.server";

export const loader = unstable_defineLoader(async ({ request }) => {
	const [{ usersList }] = await Promise.all([
		serverGqlService.request(
			UsersListDocument,
			{},
			getAuthorizationHeader(request),
		),
	]);
	return { usersList };
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => {
	return [{ title: "Your collections | Ryot" }];
};

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	await removeCachedUserCollectionsList(request);
	return namedAction(request, {
		createOrUpdate: async () => {
			const submission = processSubmission(formData, createOrUpdateSchema);
			try {
				await serverGqlService.request(
					CreateOrUpdateCollectionDocument,
					{ input: submission },
					getAuthorizationHeader(request),
				);
				return Response.json(
					{},
					{
						headers: await createToastHeaders({
							type: "success",
							message: submission.updateId
								? "Collection updated"
								: "Collection created",
						}),
					},
				);
			} catch (e) {
				let message = "An error occurred";
				if (e instanceof ClientError) {
					const err = e.response.errors?.[0].message;
					if (err) message = err;
				}
				return Response.json(
					{},
					{
						status: 400,
						headers: await createToastHeaders({ type: "error", message }),
					},
				);
			}
		},
		delete: async () => {
			const submission = processSubmission(
				formData,
				z.object({ collectionName: z.string() }),
			);
			let wasSuccessful = true;
			try {
				await serverGqlService.request(
					DeleteCollectionDocument,
					submission,
					getAuthorizationHeader(request),
				);
			} catch {
				wasSuccessful = false;
			}
			return Response.json(
				{},
				{
					headers: await createToastHeaders({
						type: wasSuccessful ? "success" : "error",
						message: wasSuccessful
							? "Collection deleted"
							: "Can not delete a default collection",
					}),
				},
			);
		},
	});
});

const createOrUpdateSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	updateId: z.string().optional(),
	collaborators: z
		.string()
		.optional()
		.transform((v) => (v ? v.split(",") : undefined)),
	informationTemplate: z
		.array(
			z.object({
				name: z.string(),
				description: z.string(),
				lot: z.nativeEnum(CollectionExtraInformationLot),
				defaultValue: z.string().optional(),
				required: zx.CheckboxAsString.optional(),
			}),
		)
		.optional(),
});

type UpdateCollectionInput = {
	name: string;
	id: string;
	isDefault: boolean;
	collaborators: Collection["collaborators"];
	description?: string | null;
	informationTemplate?: CollectionExtraInformation[] | null;
};

export default function Page() {
	const transition = useNavigation();
	const collections = useUserCollections();
	const [params] = useSearchParams();
	const query = params.get("query") || undefined;

	const filteredCollections = collections.filter((c) =>
		query ? c.name.toLowerCase().includes(query.toLowerCase()) : true,
	);

	const [toUpdateCollection, setToUpdateCollection] =
		useState<UpdateCollectionInput>();
	const [
		createOrUpdateModalOpened,
		{ open: createOrUpdateModalOpen, close: createOrUpdateModalClose },
	] = useDisclosure(false);
	useEffect(() => {
		if (transition.state !== "submitting") {
			createOrUpdateModalClose();
			setToUpdateCollection(undefined);
		}
	}, [transition.state]);

	return (
		<Container size="sm">
			<Stack>
				<Flex align="center" gap="md">
					<Title>Your collections</Title>
					<ActionIcon
						color="green"
						variant="outline"
						onClick={() => {
							setToUpdateCollection(undefined);
							createOrUpdateModalOpen();
						}}
					>
						<IconPlus size={20} />
					</ActionIcon>
					<Modal
						opened={createOrUpdateModalOpened}
						onClose={createOrUpdateModalClose}
						withCloseButton={false}
						centered
						size="lg"
					>
						<CreateOrUpdateModal toUpdateCollection={toUpdateCollection} />
					</Modal>
				</Flex>
				<DebouncedSearchInput initialValue={query} />
				<Virtuoso
					style={{ height: "80vh" }}
					data={filteredCollections}
					itemContent={(index) => {
						const c = filteredCollections[index];
						return (
							<DisplayCollection
								key={c.id}
								index={index}
								collection={c}
								setToUpdateCollection={setToUpdateCollection}
								openModal={createOrUpdateModalOpen}
							/>
						);
					}}
				/>
			</Stack>
		</Container>
	);
}

type Collection = UserCollectionsListQuery["userCollectionsList"][number];

const IMAGES_CONTAINER_WIDTH = 250;

const DisplayCollection = (props: {
	collection: Collection;
	index: number;
	setToUpdateCollection: (c: UpdateCollectionInput) => void;
	openModal: () => void;
}) => {
	const userDetails = useUserDetails();
	const fetcher = useFetcher<typeof action>();
	const deleteFormRef = useRef<HTMLFormElement>(null);
	const fallbackImageUrl = useFallbackImageUrl(props.collection.name);
	const additionalDisplay = [];

	const { data: collectionContents } = useQuery({
		queryKey: queryFactory.collections.details(props.collection.id).queryKey,
		queryFn: () =>
			clientGqlService
				.request(CollectionContentsDocument, {
					input: {
						collectionId: props.collection.id,
						take: 10,
						sort: {
							by: CollectionContentsSortBy.LastUpdatedOn,
							order: GraphqlSortOrder.Desc,
						},
					},
				})
				.then((data) => data.collectionContents),
		staleTime: dayjsLib.duration(1, "hour").asMilliseconds(),
	});

	const collectionImages = (
		collectionContents?.results.items
			.flatMap((o) => o.details.image)
			.filter((i) => isString(i)) || []
	).splice(0, 5);

	const [hoveredStates, setHoveredStates] = useListState(
		collectionImages.map(() => false),
	);

	const setHoveredState = (index: number, state: boolean) => {
		setHoveredStates.setItem(index, state);
	};

	const currentlyHovered = hoveredStates.findIndex((h) => h);

	if (props.collection.creator.id !== userDetails.id)
		additionalDisplay.push(`By ${props.collection.creator.name}`);
	if (props.collection.count > 0)
		additionalDisplay.push(`${props.collection.count} items`);
	if (props.collection.collaborators.length > 0)
		additionalDisplay.push(
			`${props.collection.collaborators.length} collaborators`,
		);

	return (
		<Paper
			pr="md"
			radius="lg"
			withBorder
			mt={props.index !== 0 ? "lg" : undefined}
			pl={{ base: "md", md: 0 }}
			py={{ base: "sm", md: 0 }}
			style={{ overflow: "hidden" }}
		>
			<Flex gap="xs" direction={{ base: "column", md: "row" }}>
				<Flex
					h={180}
					w={{ md: IMAGES_CONTAINER_WIDTH }}
					pos="relative"
					style={{ overflow: "hidden" }}
				>
					{collectionImages.length > 0 ? (
						collectionImages.map((image, index) => {
							const shouldCollapse = index < currentlyHovered;
							return (
								<CollectionImageDisplay
									key={image}
									image={image}
									index={index}
									shouldCollapse={shouldCollapse}
									setHoveredState={setHoveredState}
									totalImages={collectionImages.length}
								/>
							);
						})
					) : (
						<Image
							src={fallbackImageUrl}
							h="100%"
							flex="none"
							mx="auto"
							radius="md"
						/>
					)}
					<Box pos="absolute" left={0} right={0} bottom={0}>
						<ProRequiredAlert tooltipLabel="Collage image using collection contents" />
					</Box>
				</Flex>
				<Stack flex={1} py={{ md: "sm" }}>
					<Group justify="space-between">
						<Anchor
							component={Link}
							to={$path("/collections/:id", { id: props.collection.id })}
						>
							<Title order={4}>
								{truncate(props.collection.name, { length: 20 })}
							</Title>
						</Anchor>
						<Group gap="md">
							{additionalDisplay.length > 0 ? (
								<Text c="dimmed" size="xs">
									({additionalDisplay.join(", ")})
								</Text>
							) : null}
							{userDetails.id === props.collection.creator.id ? (
								<ActionIcon
									color="blue"
									variant="outline"
									onClick={() => {
										props.setToUpdateCollection({
											name: props.collection.name,
											id: props.collection.id,
											description: props.collection.description,
											collaborators: props.collection.collaborators,
											isDefault: props.collection.isDefault,
											informationTemplate: props.collection.informationTemplate,
										});
										props.openModal();
									}}
								>
									<IconEdit size={18} />
								</ActionIcon>
							) : null}
							{!props.collection.isDefault ? (
								<fetcher.Form
									method="POST"
									ref={deleteFormRef}
									action={withQuery("", { intent: "delete" })}
								>
									<input
										hidden
										name="collectionName"
										defaultValue={props.collection.name}
									/>
									<ActionIcon
										color="red"
										variant="outline"
										onClick={async () => {
											const conf = await confirmWrapper({
												confirmation:
													"Are you sure you want to delete this collection?",
											});
											if (conf) fetcher.submit(deleteFormRef.current);
										}}
									>
										<IconTrashFilled size={18} />
									</ActionIcon>
								</fetcher.Form>
							) : null}
						</Group>
					</Group>
					{props.collection.description ? (
						<Text size="xs" lineClamp={5}>
							{props.collection.description}
						</Text>
					) : null}
					{props.collection.isDefault ? (
						<Text lineClamp={1} mt="auto" ta="right" c="dimmed" size="xs">
							System created
						</Text>
					) : null}
				</Stack>
			</Flex>
		</Paper>
	);
};

const CollectionImageDisplay = (props: {
	image: string;
	index: number;
	totalImages: number;
	shouldCollapse: boolean;
	setHoveredState: (index: number, state: boolean) => void;
}) => {
	const { ref, hovered } = useHover();
	const offset = IMAGES_CONTAINER_WIDTH / props.totalImages - 20;

	useDidUpdate(() => {
		props.setHoveredState(props.index, hovered);
	}, [hovered]);

	return (
		<Box
			h="100%"
			w="120px"
			ref={ref}
			top={{ md: 0 }}
			pos={{ md: "absolute" }}
			left={{
				md: props.index * offset - (props.shouldCollapse ? offset * 2 : 0),
			}}
			style={{
				zIndex: props.totalImages - props.index,
				transitionProperty: "left",
				transitionDuration: "0.2s",
				transitionTimingFunction: "ease-in-out",
			}}
		>
			<Image src={props.image} h="100%" />
		</Box>
	);
};

const CreateOrUpdateModal = (props: {
	toUpdateCollection: UpdateCollectionInput | undefined;
}) => {
	const loaderData = useLoaderData<typeof loader>();
	const userDetails = useUserDetails();
	const [parent] = useAutoAnimate();
	const [informationTemplate, setInformationTemplate] =
		useListState<CollectionExtraInformation>(
			props.toUpdateCollection?.informationTemplate || [],
		);

	return (
		<Box
			method="POST"
			component={Form}
			action={withQuery("", { intent: "createOrUpdate" })}
		>
			<Stack>
				<Title order={3}>
					{props.toUpdateCollection ? "Update" : "Create"} collection
				</Title>
				<TextInput
					label="Name"
					required
					name="name"
					defaultValue={
						props.toUpdateCollection ? props.toUpdateCollection.name : undefined
					}
					readOnly={props.toUpdateCollection?.isDefault}
					description={
						props.toUpdateCollection?.isDefault
							? "Can not edit a default collection"
							: undefined
					}
				/>
				<Textarea
					label="Description"
					name="description"
					defaultValue={
						props.toUpdateCollection?.description
							? props.toUpdateCollection.description
							: undefined
					}
					autosize
				/>
				<MultiSelect
					name="collaborators"
					description="Add collaborators to this collection"
					searchable
					defaultValue={(props.toUpdateCollection?.collaborators || []).map(
						(c) => c.id,
					)}
					data={loaderData.usersList.map((u) => ({
						value: u.id,
						label: u.name,
						disabled: u.id === userDetails.id,
					}))}
				/>
				<Input.Wrapper
					labelProps={{ w: "100%" }}
					label={
						<Group wrap="nowrap" justify="space-between">
							<Input.Label size="xs">Information template</Input.Label>
							<Anchor
								size="xs"
								onClick={() =>
									setInformationTemplate.append({
										name: "",
										description: "",
										lot: CollectionExtraInformationLot.String,
									})
								}
							>
								Add field
							</Anchor>
						</Group>
					}
					description="Associate extra information when adding an entity to this collection"
				>
					<Stack gap="xs" mt="xs" ref={parent}>
						{informationTemplate.map((field, index) => (
							<Paper withBorder key={index.toString()} p="xs">
								<TextInput
									label="Name"
									required
									name={`informationTemplate[${index}].name`}
									size="xs"
									defaultValue={field.name}
								/>
								<Textarea
									label="Description"
									required
									name={`informationTemplate[${index}].description`}
									size="xs"
									defaultValue={field.description}
								/>
								<Group wrap="nowrap">
									<Select
										label="Input type"
										required
										flex={1}
										name={`informationTemplate[${index}].lot`}
										data={Object.values(CollectionExtraInformationLot).map(
											(lot) => ({ value: lot, label: changeCase(lot) }),
										)}
										size="xs"
										defaultValue={field.lot}
									/>
									<TextInput
										label="Default value"
										flex={1}
										name={`informationTemplate[${index}].defaultValue`}
										size="xs"
										defaultValue={field.defaultValue || undefined}
									/>
								</Group>
								<Group mt="xs" justify="space-around">
									<Checkbox
										label="Required"
										name={`informationTemplate[${index}].required`}
										size="sm"
										defaultChecked={field.required || undefined}
									/>
									<Button
										size="xs"
										variant="subtle"
										color="red"
										leftSection={<IconTrash />}
										onClick={() => setInformationTemplate.remove(index)}
									>
										Remove field
									</Button>
								</Group>
							</Paper>
						))}
					</Stack>
				</Input.Wrapper>
				<Button
					variant="outline"
					type="submit"
					name={props.toUpdateCollection ? "updateId" : undefined}
					value={
						props.toUpdateCollection ? props.toUpdateCollection.id : undefined
					}
				>
					{props.toUpdateCollection ? "Update" : "Create"}
				</Button>
			</Stack>
		</Box>
	);
};
