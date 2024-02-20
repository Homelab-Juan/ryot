import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import {
	Anchor,
	Badge,
	Box,
	Button,
	Flex,
	Image,
	Modal,
	MultiSelect,
	Pagination,
	PaginationProps,
	SimpleGrid,
	Stack,
	Text,
	Title,
	useComputedColorScheme,
} from "@mantine/core";
import { useFetcher } from "@remix-run/react";
import type {
	EntityLot,
	MetadataLot,
	MetadataSource,
} from "@ryot/generated/graphql/backend/graphql";
import { snakeCase } from "@ryot/ts-utils";
import { IconExternalLink } from "@tabler/icons-react";
import { ReactNode, forwardRef, useRef } from "react";
import { useState } from "react";
import events from "~/lib/events";
import { getFallbackImageUrl } from "~/lib/generals";
import classes from "~/styles/common.module.css";

export const ApplicationGrid = (props: {
	children: ReactNode[];
}) => {
	return (
		<SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="lg">
			{props.children}
		</SimpleGrid>
	);
};

export const ApplicationPagination = forwardRef<
	HTMLDivElement,
	PaginationProps
>((props, ref) => {
	if (props.total === 1) return null;
	return <Pagination {...props} ref={ref} boundaries={1} siblings={0} />;
});

function getSurroundingElements<T>(array: T[], element: number): number[] {
	if (array.length === 1) return [0];
	const lastIndex = array.length - 1;
	if (element === 0) return [lastIndex, element, element + 1];
	if (element === lastIndex) return [element - 1, element, 0];
	return [element - 1, element, element + 1];
}

export const MediaDetailsLayout = (props: {
	children: ReactNode | (ReactNode | undefined)[];
	images: (string | null | undefined)[];
	externalLink?: {
		source: MetadataSource;
		lot?: MetadataLot;
		href?: string | null;
	};
}) => {
	const [activeImageId, setActiveImageId] = useState(0);
	const colorScheme = useComputedColorScheme("dark");

	return (
		<Flex direction={{ base: "column", md: "row" }} gap="lg">
			<Box
				id="images-container"
				pos="relative"
				className={classes.imagesContainer}
			>
				{props.images.length > 1 ? (
					<Carousel
						withIndicators={props.images.length > 1}
						w={300}
						onSlideChange={setActiveImageId}
					>
						{props.images.map((url, idx) => (
							<Carousel.Slide key={url} data-image-idx={idx}>
								{getSurroundingElements(props.images, activeImageId).includes(
									idx,
								) ? (
									<Image src={url} radius="lg" />
								) : null}
							</Carousel.Slide>
						))}
					</Carousel>
				) : (
					<Box w={300}>
						<Image
							src={props.images[0]}
							height={400}
							radius="lg"
							fallbackSrc={getFallbackImageUrl(colorScheme)}
						/>
					</Box>
				)}
				{props.externalLink ? (
					<Badge
						id="data-source"
						pos="absolute"
						size="lg"
						top={10}
						left={10}
						color="dark"
						variant="filled"
					>
						<Flex gap={4} align="center">
							<Text size="10">
								{snakeCase(props.externalLink.source)}
								{props.externalLink.lot
									? `:${snakeCase(props.externalLink.lot)}`
									: null}
							</Text>
							{props.externalLink.href ? (
								<Anchor href={props.externalLink.href} target="_blank" mt={2}>
									<IconExternalLink size={12.8} />
								</Anchor>
							) : null}
						</Flex>
					</Badge>
				) : null}
			</Box>
			<Stack id="details-container" style={{ flexGrow: 1 }}>
				{props.children}
			</Stack>
		</Flex>
	);
};

export const AddEntityToCollectionModal = (props: {
	opened: boolean;
	onClose: () => void;
	entityId: string;
	entityLot: EntityLot;
	collections: string[];
}) => {
	const addEntityToCollectionFormRef = useRef<HTMLFormElement>(null);
	const addEntityToCollectionFetcher = useFetcher();

	return (
		<Modal
			opened={props.opened}
			onClose={props.onClose}
			withCloseButton={false}
			centered
		>
			<addEntityToCollectionFetcher.Form
				action="/actions?intent=addEntityToCollection"
				method="post"
				ref={addEntityToCollectionFormRef}
			>
				<input hidden name="entityId" defaultValue={props.entityId} />
				<input hidden name="entityLot" defaultValue={props.entityLot} />
				<Stack>
					<Title order={3}>Select collection</Title>
					<MultiSelect
						data={props.collections}
						searchable
						name="collectionName"
						nothingFoundMessage="Nothing found..."
					/>
					<Button
						data-autofocus
						variant="outline"
						onClick={() => {
							addEntityToCollectionFetcher.submit(
								addEntityToCollectionFormRef.current,
							);
							events.addToCollection(props.entityLot);
							props.onClose();
						}}
					>
						Set
					</Button>
					<Button variant="outline" color="red" onClick={props.onClose}>
						Cancel
					</Button>
				</Stack>
			</addEntityToCollectionFetcher.Form>
		</Modal>
	);
};
